use std::collections::VecDeque;
use std::fs::File;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex, MutexGuard, TryLockError};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, SampleFormat, Stream, StreamConfig, SupportedBufferSize};
use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;
use symphonia::default::{get_codecs, get_probe};
use tauri::{AppHandle, Emitter, State};

use crate::models::{PlayRequest, PlaybackState, QueueTrack};
use crate::util::normalize_loop;
use crate::AppState;

pub struct AudioEngine {
    cmd_tx: Sender<Cmd>,
    shared: Arc<Shared>,
}

enum Cmd {
    Play {
        tracks: Vec<QueueTrack>,
        start_index: usize,
        loop_mode: String,
    },
    Pause,
    Resume,
    Toggle,
    Seek(f64),
    SetRate(f32),
    SetLoop(String),
    Next,
    Previous,
    Stop,
    SetCrossfade(f32),
    Retarget { tracks: Vec<QueueTrack>, index: usize },
    Describe {
        id: String,
        title: String,
        artist: String,
        cover: String,
    },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LoopMode {
    Off,
    Track,
    Playlist,
}

impl LoopMode {
    fn parse(value: &str) -> Self {
        match normalize_loop(value) {
            "track" => Self::Track,
            "playlist" => Self::Playlist,
            _ => Self::Off,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Track => "track",
            Self::Playlist => "playlist",
        }
    }
}

enum PumpStatus {
    Buffered,
    Pumped,
    Eof,
    Idle,
    Error(String),
}

struct Player {
    queue: Vec<QueueTrack>,
    index: usize,
    loop_mode: LoopMode,
    rate: f32,
    paused: bool,
    ended: bool,
    crossfade: f32,
    current: Option<Active>,
    blend: Option<Blend>,
}

struct Blend {
    incoming: Active,
    next_index: usize,
    frames_done: usize,
    frames_total: usize,
    announced: bool,
    announce_at: f64,
}

struct Active {
    path: std::path::PathBuf,
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    sample_rate: u32,
    duration: f64,
    pending: VecDeque<f32>,
    cursor: f64,
    eof: bool,
    lp_left: f32,
    lp_right: f32,
    lp2_left: f32,
    lp2_right: f32,
    sample_buf: Option<SampleBuffer<f32>>,
    sample_channels: usize,
}

struct Shared {
    playback: Mutex<VecDeque<f32>>,
    spectrum: Mutex<VecDeque<f32>>,
    paused: AtomicBool,
    has_track: AtomicBool,
    playing: AtomicBool,
    generation: AtomicU64,
    position: AtomicU64,
    duration: AtomicU64,
    rate_bits: AtomicU32,
    volume_bits: AtomicU32,
    track_gain_bits: AtomicU32,
    gain_bits: AtomicU32,
    device_rate: AtomicU32,
    fade_left: AtomicU32,
    index: AtomicUsize,
    queue_len: AtomicUsize,
    track_id: Mutex<String>,
    title: Mutex<String>,
    artist: Mutex<String>,
    cover: Mutex<String>,
    loop_mode: Mutex<String>,
    error: Mutex<String>,
    device_error: Mutex<String>,
    output_broken: AtomicBool,
    output_thread: Mutex<Option<thread::Thread>>,
}

impl Shared {
    fn new() -> Self {
        Self {
            playback: Mutex::new(VecDeque::with_capacity(192_000)),
            spectrum: Mutex::new(VecDeque::with_capacity(4096)),
            paused: AtomicBool::new(true),
            has_track: AtomicBool::new(false),
            playing: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            position: AtomicU64::new(0),
            duration: AtomicU64::new(0),
            rate_bits: AtomicU32::new(1f32.to_bits()),
            volume_bits: AtomicU32::new(1f32.to_bits()),
            track_gain_bits: AtomicU32::new(1f32.to_bits()),
            gain_bits: AtomicU32::new(1f32.to_bits()),
            device_rate: AtomicU32::new(48_000),
            fade_left: AtomicU32::new(0),
            index: AtomicUsize::new(0),
            queue_len: AtomicUsize::new(0),
            track_id: Mutex::new(String::new()),
            title: Mutex::new(String::new()),
            artist: Mutex::new(String::new()),
            cover: Mutex::new(String::new()),
            loop_mode: Mutex::new("off".into()),
            error: Mutex::new(String::new()),
            device_error: Mutex::new(String::new()),
            output_broken: AtomicBool::new(false),
            output_thread: Mutex::new(None),
        }
    }
}

impl AudioEngine {
    pub fn start(app: AppHandle) -> Self {
        let (cmd_tx, cmd_rx) = mpsc::channel();
        let shared = Arc::new(Shared::new());
        mark_music_stream();
        let rate = spawn_output(shared.clone());
        shared.device_rate.store(rate, Ordering::Relaxed);
        let decode_shared = shared.clone();
        let decode_app = app.clone();
        thread::Builder::new()
            .name("orfeus-audio".into())
            .spawn(move || thread_main(cmd_rx, decode_shared, decode_app))
            .expect("audio thread");
        let fft_shared = shared.clone();
        thread::Builder::new()
            .name("orfeus-spectrum".into())
            .spawn(move || spectrum_loop(fft_shared, app))
            .expect("thread de espectro");
        Self { cmd_tx, shared }
    }

    pub fn snapshot(&self) -> PlaybackState {
        snapshot(&self.shared)
    }

    fn send(&self, cmd: Cmd) -> Result<(), String> {
        self.cmd_tx
            .send(cmd)
            .map_err(|_| "The audio engine stopped.".to_string())
    }

    pub fn retarget(&self, tracks: Vec<QueueTrack>, index: usize) -> Result<(), String> {
        self.send(Cmd::Retarget { tracks, index })
    }

    pub fn play(&self, request: PlayRequest) -> Result<(), String> {
        let device_error = lock_string(&self.shared.device_error).clone();
        if !device_error.is_empty() {
            return Err(device_error);
        }
        self.send(Cmd::Play {
            tracks: request.tracks,
            start_index: request.start_index,
            loop_mode: request.loop_mode,
        })
    }

    pub fn pause(&self) -> Result<(), String> {
        self.send(Cmd::Pause)
    }

    pub fn resume(&self) -> Result<(), String> {
        self.send(Cmd::Resume)
    }

    pub fn toggle(&self) -> Result<(), String> {
        self.send(Cmd::Toggle)
    }

    pub fn seek(&self, seconds: f64) -> Result<(), String> {
        self.send(Cmd::Seek(seconds))
    }

    pub fn set_rate(&self, rate: f32) -> Result<(), String> {
        let Some(rate) = allowed_rate(rate) else {
            return Err("Use 0.5×, 1×, 1.2×, 1.5×, 2×, −1.2×, or −1.5×.".into());
        };
        self.send(Cmd::SetRate(rate))
    }

    pub fn set_loop(&self, mode: String) -> Result<(), String> {
        self.send(Cmd::SetLoop(mode))
    }

    pub fn set_crossfade(&self, seconds: f32) -> Result<(), String> {
        self.send(Cmd::SetCrossfade(allowed_crossfade(seconds)))
    }

    pub fn set_volume(&self, volume: f32) {
        self.shared
            .volume_bits
            .store(finite_unit(volume, 1.0).to_bits(), Ordering::Relaxed);
    }

    pub fn set_track_gain(&self, gain: f32) {
        self.shared
            .track_gain_bits
            .store(finite_track_gain(gain).to_bits(), Ordering::Relaxed);
    }

    pub fn next(&self) -> Result<(), String> {
        self.send(Cmd::Next)
    }

    pub fn previous(&self) -> Result<(), String> {
        self.send(Cmd::Previous)
    }

    pub fn stop(&self) -> Result<(), String> {
        self.send(Cmd::Stop)
    }

    pub fn current_track_id(&self) -> String {
        lock_string(&self.shared.track_id).clone()
    }

    pub fn set_display(&self, id: &str, title: &str, artist: &str, cover: Option<&str>) {
        let _ = self.send(Cmd::Describe {
            id: id.to_string(),
            title: title.to_string(),
            artist: artist.to_string(),
            cover: cover.unwrap_or("").to_string(),
        });
    }
}

#[tauri::command]
pub fn play(state: State<AppState>, request: PlayRequest) -> Result<(), String> {
    state.audio.play(request)
}

#[tauri::command]
pub fn retarget(state: State<AppState>, tracks: Vec<QueueTrack>, index: usize) -> Result<(), String> {
    state.audio.retarget(tracks, index)
}

#[tauri::command]
pub fn pause(state: State<AppState>) -> Result<(), String> {
    state.audio.pause()
}

#[tauri::command]
pub fn resume(state: State<AppState>) -> Result<(), String> {
    state.audio.resume()
}

#[tauri::command]
pub fn toggle(state: State<AppState>) -> Result<(), String> {
    state.audio.toggle()
}

#[tauri::command]
pub fn seek(state: State<AppState>, seconds: f64) -> Result<(), String> {
    state.audio.seek(seconds)
}

#[tauri::command]
pub fn set_rate(state: State<AppState>, rate: f32) -> Result<(), String> {
    state.audio.set_rate(rate)
}

#[tauri::command]
pub fn set_loop(state: State<AppState>, mode: String) -> Result<(), String> {
    state.audio.set_loop(mode)
}

#[tauri::command]
pub fn set_crossfade(state: State<AppState>, seconds: f32) -> Result<(), String> {
    state.audio.set_crossfade(seconds)
}

#[tauri::command]
pub fn set_volume(state: State<AppState>, volume: f32) {
    state.audio.set_volume(volume);
}

#[tauri::command]
pub fn set_track_gain(state: State<AppState>, gain: f32) {
    state.audio.set_track_gain(gain);
}

#[tauri::command]
pub fn next(state: State<AppState>) -> Result<(), String> {
    state.audio.next()
}

#[tauri::command]
pub fn previous(state: State<AppState>) -> Result<(), String> {
    state.audio.previous()
}

#[tauri::command]
pub fn stop(state: State<AppState>) -> Result<(), String> {
    state.audio.stop()
}

#[tauri::command]
pub fn playback_state(state: State<AppState>) -> PlaybackState {
    state.audio.snapshot()
}

fn allowed_crossfade(seconds: f32) -> f32 {
    if (seconds - 1.5).abs() < 0.05 {
        1.5
    } else if (seconds - 3.0).abs() < 0.05 {
        3.0
    } else if (seconds - 5.0).abs() < 0.05 {
        5.0
    } else {
        0.0
    }
}

fn allowed_rate(rate: f32) -> Option<f32> {
    const RATES: [f32; 7] = [0.5, 1.0, 1.2, 1.5, 2.0, -1.2, -1.5];
    RATES.into_iter().find(|item| (item - rate).abs() < 0.02)
}

fn thread_main(rx: Receiver<Cmd>, shared: Arc<Shared>, app: AppHandle) {
    let mut player = Player {
        queue: Vec::new(),
        index: 0,
        loop_mode: LoopMode::Off,
        rate: 1.0,
        paused: true,
        ended: false,
        crossfade: 0.0,
        current: None,
        blend: None,
    };
    let mut last_emit = Instant::now();
    loop {
        loop {
            match rx.try_recv() {
                Ok(cmd) => {
                    handle(&mut player, &shared, cmd);
                    emit_state(&app, &shared);
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return,
            }
        }

        let status = if player.paused || (player.current.is_none() && player.blend.is_none()) {
            PumpStatus::Idle
        } else {
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let dst_rate = shared.device_rate.load(Ordering::Relaxed).max(8_000);
                pump_player(&mut player, &shared, dst_rate)
            })) {
                Ok(status) => status,
                Err(_) => {
                    player.current = None;
                    player.blend = None;
                    PumpStatus::Error("Playback hit a bad frame and skipped ahead.".into())
                }
            }
        };

        match status {
            PumpStatus::Error(err) => {
                set_error(&shared, &err);
                let next = player.index + 1;
                player.current = None;
                player.blend = None;
                if !open_from(&mut player, &shared, next) {
                    finish(&mut player, &shared);
                }
                emit_state(&app, &shared);
            }
            PumpStatus::Eof => {
                let drained = queue_mut(&shared).len() < 8;
                if drained {
                    if player.rate < 0.0 {
                        finish(&mut player, &shared);
                    } else {
                        let next = player.index + 1;
                        if !open_from(&mut player, &shared, next) {
                            finish(&mut player, &shared);
                        }
                    }
                    emit_state(&app, &shared);
                } else if let Err(TryRecvError::Disconnected) = wait_cmd(&rx, &mut player, &shared) {
                    return;
                }
            }
            PumpStatus::Buffered | PumpStatus::Idle => {
                if let Err(TryRecvError::Disconnected) = wait_cmd(&rx, &mut player, &shared) {
                    return;
                }
            }
            PumpStatus::Pumped => {}
        }

        if last_emit.elapsed() >= Duration::from_millis(200) {
            emit_state(&app, &shared);
            last_emit = Instant::now();
        }
    }
}

fn wait_cmd(rx: &Receiver<Cmd>, player: &mut Player, shared: &Shared) -> Result<(), TryRecvError> {
    match rx.recv_timeout(Duration::from_millis(12)) {
        Ok(cmd) => {
            handle(player, shared, cmd);
            Ok(())
        }
        Err(mpsc::RecvTimeoutError::Timeout) => Ok(()),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(TryRecvError::Disconnected),
    }
}

fn handle(player: &mut Player, shared: &Shared, cmd: Cmd) {
    match cmd {
        Cmd::Play {
            tracks,
            start_index,
            loop_mode,
        } => {
            player.queue = tracks;
            player.loop_mode = LoopMode::parse(&loop_mode);
            player.ended = false;
            player.paused = false;
            player.current = None;
            player.blend = None;
            let start = if player.queue.is_empty() {
                0
            } else {
                start_index.min(player.queue.len() - 1)
            };
            if player.queue.is_empty() || !open_from(player, shared, start) {
                stop_player(player, shared);
            }
        }
        Cmd::Pause => {
            player.paused = true;
            sync_flags(player, shared);
        }
        Cmd::Resume => resume_playback(player, shared),
        Cmd::Toggle => {
            if player.paused {
                resume_playback(player, shared);
            } else {
                player.paused = true;
                sync_flags(player, shared);
            }
        }
        Cmd::Seek(seconds) => {
            if player.blend.as_ref().is_some_and(|blend| blend.announced) {
                promote_blend(player, shared);
            } else {
                player.blend = None;
            }
            if let Some(active) = player.current.as_mut() {
                player.ended = false;
                if let Err(err) = seek_to(active, shared, seconds) {
                    set_error(shared, &err);
                }
            }
        }
        Cmd::SetRate(rate) => {
            player.rate = rate;
            shared.rate_bits.store(rate.to_bits(), Ordering::Relaxed);
        }
        Cmd::SetLoop(mode) => {
            player.loop_mode = LoopMode::parse(&mode);
            *lock_string(&shared.loop_mode) = player.loop_mode.as_str().into();
        }
        Cmd::SetCrossfade(seconds) => {
            player.crossfade = allowed_crossfade(seconds);
        }
        Cmd::Retarget { tracks, index } => {
            let current = lock_string(&shared.track_id).clone();
            player.queue = tracks;
            player.blend = None;
            if let Some(found) = player.queue.iter().position(|track| track.id == current) {
                player.index = found;
            } else if !player.queue.is_empty() {
                player.index = index.min(player.queue.len() - 1);
            }
            publish(player, shared);
            sync_flags(player, shared);
        }
        Cmd::Next => {
            let start = match &player.blend {
                Some(blend) => blend.next_index + 1,
                None => player.index + 1,
            };
            player.blend = None;
            if !transition(player, shared, start, true) {
                finish(player, shared);
            }
        }
        Cmd::Previous => {
            let announced = player.blend.as_ref().is_some_and(|blend| blend.announced);
            if announced {
                promote_blend(player, shared);
            } else {
                player.blend = None;
            }
            let position = f64::from_bits(shared.position.load(Ordering::Relaxed));
            if position > 2.0 || player.index == 0 {
                if let Some(active) = player.current.as_mut() {
                    player.ended = false;
                    let _ = seek_to(active, shared, 0.0);
                }
            } else if !transition(player, shared, player.index.saturating_sub(1), true) {
                finish(player, shared);
            }
        }
        Cmd::Stop => stop_player(player, shared),
        Cmd::Describe {
            id,
            title,
            artist,
            cover,
        } => {
            if let Some(track) = player.queue.iter_mut().find(|track| track.id == id) {
                track.title = title.clone();
                track.artist = artist.clone();
                track.cover_path = if cover.is_empty() { None } else { Some(cover.clone()) };
            }
            if lock_string(&shared.track_id).as_str() == id {
                *lock_string(&shared.title) = title;
                *lock_string(&shared.artist) = artist;
                *lock_string(&shared.cover) = cover;
            }
        }
    }
}

fn resume_playback(player: &mut Player, shared: &Shared) {
    if player.ended {
        player.ended = false;
        player.paused = false;
        if let Some(active) = player.current.as_mut() {
            if rewind(active).is_ok() {
                clear_heard(shared);
                shared.position.store(0f64.to_bits(), Ordering::Relaxed);
            }
        } else if !player.queue.is_empty() {
            let _ = open_from(player, shared, player.index);
        }
    } else if player.current.is_some() {
        player.paused = false;
    } else if !player.queue.is_empty() {
        player.paused = false;
        let _ = open_from(player, shared, player.index);
    }
    sync_flags(player, shared);
}

fn finish(player: &mut Player, shared: &Shared) {
    player.paused = true;
    player.ended = true;
    let duration = f64::from_bits(shared.duration.load(Ordering::Relaxed));
    shared.position.store(duration.to_bits(), Ordering::Relaxed);
    sync_flags(player, shared);
}

fn stop_player(player: &mut Player, shared: &Shared) {
    player.queue.clear();
    player.index = 0;
    player.current = None;
    player.blend = None;
    player.paused = true;
    player.ended = false;
    clear_heard(shared);
    shared.position.store(0f64.to_bits(), Ordering::Relaxed);
    shared.duration.store(0f64.to_bits(), Ordering::Relaxed);
    *lock_string(&shared.track_id) = String::new();
    *lock_string(&shared.title) = String::new();
    *lock_string(&shared.artist) = String::new();
    *lock_string(&shared.cover) = String::new();
    set_error(shared, "");
    sync_flags(player, shared);
}

fn open_from(player: &mut Player, shared: &Shared, start: usize) -> bool {
    player.blend = None;
    if player.queue.is_empty() {
        player.current = None;
        sync_flags(player, shared);
        return false;
    }
    let len = player.queue.len();
    for step in 0..len {
        let index = match player.loop_mode {
            LoopMode::Playlist => (start + step) % len,
            LoopMode::Off | LoopMode::Track => {
                if start + step >= len {
                    player.current = None;
                    sync_flags(player, shared);
                    return false;
                }
                start + step
            }
        };
        let track = &player.queue[index];
        let fallback = (track.duration_ms > 0).then_some(track.duration_ms as f64 / 1000.0);
        match open_active(Path::new(&track.path), fallback) {
            Ok(mut active) => {
                if active.duration <= 0.0 {
                    active.duration = fallback.unwrap_or(0.0);
                }
                let duration = active.duration;
                player.index = index;
                player.current = Some(active);
                player.ended = false;
                player.paused = false;
                clear_heard(shared);
                shared.position.store(0f64.to_bits(), Ordering::Relaxed);
                shared.duration.store(duration.to_bits(), Ordering::Relaxed);
                publish(player, shared);
                set_error(shared, "");
                sync_flags(player, shared);
                return true;
            }
            Err(err) => set_error(shared, &err),
        }
    }
    player.current = None;
    sync_flags(player, shared);
    false
}

fn publish(player: &Player, shared: &Shared) {
    if let Some(track) = player.queue.get(player.index) {
        *lock_string(&shared.track_id) = track.id.clone();
        *lock_string(&shared.title) = track.title.clone();
        *lock_string(&shared.artist) = track.artist.clone();
        *lock_string(&shared.cover) = track.cover_path.clone().unwrap_or_default();
    }
    *lock_string(&shared.loop_mode) = player.loop_mode.as_str().into();
}

fn sync_flags(player: &Player, shared: &Shared) {
    shared.paused.store(player.paused, Ordering::Relaxed);
    shared.has_track.store(player.current.is_some(), Ordering::Relaxed);
    shared
        .playing
        .store(!player.paused && player.current.is_some(), Ordering::Relaxed);
    shared.index.store(player.index, Ordering::Relaxed);
    shared.queue_len.store(player.queue.len(), Ordering::Relaxed);
    shared.rate_bits.store(player.rate.to_bits(), Ordering::Relaxed);
    *lock_string(&shared.loop_mode) = player.loop_mode.as_str().into();
}

fn open_active(path: &Path, fallback_duration: Option<f64>) -> Result<Active, String> {
    let file = File::open(path).map_err(|_| format!("Could not open {}.", path.display()))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|ext| ext.to_str()) {
        hint.with_extension(ext);
    }
    let probed = get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions {
                enable_gapless: true,
                ..Default::default()
            },
            &MetadataOptions::default(),
        )
        .map_err(|err| err.to_string())?;
    let format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "No audio track in this file.".to_string())?;
    let track_id = track.id;
    let codec_params = track.codec_params.clone();
    let duration = track_duration(&codec_params).or(fallback_duration).unwrap_or(0.0);
    let sample_rate = codec_params.sample_rate.unwrap_or(0);
    let decoder = get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|err| err.to_string())?;
    Ok(Active {
        path: path.to_path_buf(),
        format,
        decoder,
        track_id,
        sample_rate,
        duration,
        pending: VecDeque::with_capacity(16_384),
        cursor: 0.0,
        eof: false,
        lp_left: 0.0,
        lp_right: 0.0,
        lp2_left: 0.0,
        lp2_right: 0.0,
        sample_buf: None,
        sample_channels: 0,
    })
}

fn track_duration(params: &symphonia::core::codecs::CodecParameters) -> Option<f64> {
    let frames = params.n_frames?;
    let rate = params.sample_rate?;
    if rate == 0 {
        return None;
    }
    Some(frames as f64 / rate as f64)
}

fn seek_to(active: &mut Active, shared: &Shared, seconds: f64) -> Result<(), String> {
    let target = if active.duration > 0.0 {
        seconds.clamp(0.0, active.duration)
    } else {
        seconds.max(0.0)
    };
    let whole = target.floor() as u64;
    let frac = (target - whole as f64).clamp(0.0, 0.999_999);
    let seek = active.format.seek(
        SeekMode::Accurate,
        SeekTo::Time {
            time: Time::new(whole, frac),
            track_id: Some(active.track_id),
        },
    );
    if seek.is_err() {
        if target < 0.05 {
            let path = active.path.clone();
            let duration = active.duration;
            *active = open_active(&path, Some(duration))?;
            active.duration = duration;
        } else {
            return Err("Could not seek in this track.".into());
        }
    } else {
        active.decoder.reset();
        active.pending.clear();
        active.cursor = 0.0;
        active.eof = false;
        active.lp_left = 0.0;
        active.lp_right = 0.0;
        active.lp2_left = 0.0;
        active.lp2_right = 0.0;
    }
    clear_heard(shared);
    shared.position.store(target.to_bits(), Ordering::Relaxed);
    Ok(())
}

fn rewind(active: &mut Active) -> Result<(), String> {
    if active
        .format
        .seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time: Time::new(0, 0.0),
                track_id: Some(active.track_id),
            },
        )
        .is_ok()
    {
        active.decoder.reset();
        active.pending.clear();
        active.cursor = 0.0;
        active.eof = false;
        active.lp_left = 0.0;
        active.lp_right = 0.0;
        active.lp2_left = 0.0;
        active.lp2_right = 0.0;
        return Ok(());
    }
    let path = active.path.clone();
    let duration = active.duration;
    *active = open_active(&path, Some(duration))?;
    active.duration = duration;
    Ok(())
}

fn pump_player(player: &mut Player, shared: &Shared, dst_rate: u32) -> PumpStatus {
    if player.blend.is_some() {
        return pump_blend(player, shared, dst_rate);
    }
    if should_crossfade(player, shared, dst_rate) {
        let start = player.index + 1;
        let _ = transition(player, shared, start, false);
        if player.blend.is_some() {
            return pump_blend(player, shared, dst_rate);
        }
    }
    let Some(active) = player.current.as_mut() else {
        return PumpStatus::Idle;
    };
    let rate = player.rate;
    let loop_mode = player.loop_mode;
    if rate < 0.0 {
        return reverse_chunk(active, shared, dst_rate, rate.abs());
    }
    pump(active, shared, dst_rate, rate, loop_mode)
}

fn reverse_chunk(active: &mut Active, shared: &Shared, dst_rate: u32, speed: f32) -> PumpStatus {
    let pos = f64::from_bits(shared.position.load(Ordering::Relaxed));
    if pos <= 0.05 {
        return PumpStatus::Eof;
    }
    let max_samples = (dst_rate as usize).saturating_mul(2);
    let queued = queue_mut(shared).len();
    if queued >= max_samples {
        return PumpStatus::Buffered;
    }
    let room = ((max_samples - queued) / 2).clamp(1, 4096);
    let seconds = room as f64 * f64::from(speed) / dst_rate.max(1) as f64;
    let start = (pos - seconds).max(0.0);
    if let Err(err) = seek_to(active, shared, start) {
        return PumpStatus::Error(err);
    }
    shared.position.store(pos.to_bits(), Ordering::Relaxed);
    match fill_frames(active, dst_rate, speed, room) {
        Ok(produced) if !produced.is_empty() => {
            let frames = produced.len() / 2;
            let mut reversed = Vec::with_capacity(produced.len());
            for index in (0..frames).rev() {
                reversed.push(produced[index * 2]);
                reversed.push(produced[index * 2 + 1]);
            }
            queue_mut(shared).extend(reversed);
            PumpStatus::Pumped
        }
        Ok(_) => PumpStatus::Eof,
        Err(err) => PumpStatus::Error(err),
    }
}

fn should_crossfade(player: &Player, shared: &Shared, dst_rate: u32) -> bool {
    if player.rate < 0.0 || player.crossfade <= 0.05 || player.loop_mode == LoopMode::Track || player.current.is_none() {
        return false;
    }
    let Some(active) = player.current.as_ref() else {
        return false;
    };
    if active.duration <= 0.0 || resolve_index(player, player.index + 1).is_none() {
        return false;
    }
    remaining_wall(player, shared, dst_rate, active.duration) <= f64::from(player.crossfade)
}

fn remaining_wall(player: &Player, shared: &Shared, dst_rate: u32, duration: f64) -> f64 {
    let heard = f64::from_bits(shared.position.load(Ordering::Relaxed));
    let queued = queue_mut(shared).len() / 2;
    let dst = f64::from(dst_rate.max(1));
    let rate = f64::from(player.rate.max(0.05));
    let upcoming = heard + queued as f64 / dst * rate;
    (duration - upcoming) / rate
}

fn resolve_index(player: &Player, start: usize) -> Option<usize> {
    let len = player.queue.len();
    if len == 0 {
        return None;
    }
    match player.loop_mode {
        LoopMode::Playlist => Some(start % len),
        LoopMode::Off | LoopMode::Track => (start < len).then_some(start),
    }
}

fn transition(player: &mut Player, shared: &Shared, start: usize, manual: bool) -> bool {
    if player.crossfade <= 0.05 || player.current.is_none() {
        return open_from(player, shared, start);
    }
    let Some(index) = resolve_index(player, start) else {
        player.blend = None;
        player.current = None;
        sync_flags(player, shared);
        return false;
    };
    let track = &player.queue[index];
    let fallback = (track.duration_ms > 0).then_some(track.duration_ms as f64 / 1000.0);
    let path = track.path.clone();
    if manual {
        clear_heard(shared);
    }
    let incoming = match open_active(Path::new(&path), fallback) {
        Ok(mut active) => {
            if active.duration <= 0.0 {
                active.duration = fallback.unwrap_or(0.0);
            }
            active
        }
        Err(err) => {
            set_error(shared, &err);
            return open_from(player, shared, index + 1);
        }
    };
    let dst = shared.device_rate.load(Ordering::Relaxed).max(8_000);
    let mut seconds = player.crossfade;
    if !manual {
        if let Some(active) = player.current.as_ref() {
            let left = remaining_wall(player, shared, dst, active.duration).max(0.0) as f32;
            seconds = seconds.min(left).max(0.15);
        }
    }
    let frames = (seconds * dst as f32).round().max(1.0) as usize;
    let heard = f64::from_bits(shared.position.load(Ordering::Relaxed));
    let announce_at = if manual {
        heard
    } else {
        player
            .current
            .as_ref()
            .map(|active| (active.duration - f64::from(seconds) * f64::from(player.rate.max(0.05))).max(0.0))
            .unwrap_or(heard)
    };
    player.ended = false;
    player.paused = false;
    player.blend = Some(Blend {
        incoming,
        next_index: index,
        frames_done: 0,
        frames_total: frames,
        announced: false,
        announce_at,
    });
    sync_flags(player, shared);
    true
}

fn promote_blend(player: &mut Player, shared: &Shared) {
    let Some(blend) = player.blend.take() else {
        return;
    };
    player.index = blend.next_index;
    let duration = blend.incoming.duration;
    player.current = Some(blend.incoming);
    player.ended = false;
    if !blend.announced {
        publish(player, shared);
        let into = blend.frames_done as f64 / f64::from(shared.device_rate.load(Ordering::Relaxed).max(1))
            * f64::from(player.rate.max(0.05));
        shared.position.store(into.to_bits(), Ordering::Relaxed);
        shared.duration.store(duration.to_bits(), Ordering::Relaxed);
    }
    sync_flags(player, shared);
}

fn announce_blend(player: &mut Player, shared: &Shared) {
    let heard = f64::from_bits(shared.position.load(Ordering::Relaxed));
    let Some((next_index, duration)) = player.blend.as_mut().and_then(|blend| {
        if blend.announced || heard + 0.03 < blend.announce_at {
            return None;
        }
        blend.announced = true;
        Some((blend.next_index, blend.incoming.duration))
    }) else {
        return;
    };
    player.index = next_index;
    publish(player, shared);
    shared.position.store(0f64.to_bits(), Ordering::Relaxed);
    shared.duration.store(duration.to_bits(), Ordering::Relaxed);
    sync_flags(player, shared);
}

fn pump_blend(player: &mut Player, shared: &Shared, dst_rate: u32) -> PumpStatus {
    announce_blend(player, shared);
    let max_samples = (dst_rate as usize).saturating_mul(2);
    let queued = queue_mut(shared).len();
    if queued >= max_samples {
        return PumpStatus::Buffered;
    }
    let Some((done, total)) = player.blend.as_ref().map(|blend| (blend.frames_done, blend.frames_total)) else {
        return PumpStatus::Idle;
    };
    if done >= total {
        promote_blend(player, shared);
        return PumpStatus::Pumped;
    }
    let remain = total.saturating_sub(done).max(1);
    let room = ((max_samples - queued) / 2).clamp(1, 4096).min(remain);
    let rate = player.rate;
    let outgoing = match player.current.as_mut() {
        Some(active) => fill_frames(active, dst_rate, rate, room),
        None => Ok(Vec::new()),
    };
    let incoming = match player.blend.as_mut() {
        Some(blend) => fill_frames(&mut blend.incoming, dst_rate, rate, room),
        None => Ok(Vec::new()),
    };
    let (outgoing, incoming) = match (outgoing, incoming) {
        (Ok(outgoing), Ok(incoming)) => (outgoing, incoming),
        (Err(err), _) | (_, Err(err)) => return PumpStatus::Error(err),
    };
    let frames = (outgoing.len() / 2).max(incoming.len() / 2);
    if frames == 0 {
        promote_blend(player, shared);
        return PumpStatus::Pumped;
    }
    let start = done;
    let total = total.max(1);
    let mixed = mix_crossfade(&outgoing, &incoming, start, total);
    let mixed_frames = mixed.len() / 2;
    if mixed_frames == 0 {
        promote_blend(player, shared);
        return PumpStatus::Pumped;
    }
    queue_mut(shared).extend(mixed);
    let finished = player.blend.as_mut().is_some_and(|blend| {
        blend.frames_done += mixed_frames;
        blend.frames_done >= blend.frames_total
    });
    if finished {
        promote_blend(player, shared);
    }
    PumpStatus::Pumped
}

fn ease_in_out(progress: f32) -> f32 {
    let t = progress.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn mix_crossfade(outgoing: &[f32], incoming: &[f32], start_frame: usize, total: usize) -> Vec<f32> {
    let frames = (outgoing.len() / 2).max(incoming.len() / 2);
    let total = total.max(1);
    let mut mixed = Vec::with_capacity(frames * 2);
    for index in 0..frames {
        let span = total.saturating_sub(1).max(1) as f32;
        let progress = (start_frame + index) as f32 / span;
        let fade_in = ease_in_out(progress);
        let fade_out = 1.0 - fade_in;
        let left = outgoing.get(index * 2).copied().unwrap_or(0.0) * fade_out
            + incoming.get(index * 2).copied().unwrap_or(0.0) * fade_in;
        let right = outgoing.get(index * 2 + 1).copied().unwrap_or(0.0) * fade_out
            + incoming.get(index * 2 + 1).copied().unwrap_or(0.0) * fade_in;
        mixed.push(left);
        mixed.push(right);
    }
    mixed
}

fn pump(
    active: &mut Active,
    shared: &Shared,
    dst_rate: u32,
    rate: f32,
    loop_mode: LoopMode,
) -> PumpStatus {
    if active.sample_rate == 0 {
        if let Err(err) = decode_until_rate(active) {
            return PumpStatus::Error(err);
        }
        if active.sample_rate == 0 {
            return if active.eof {
                PumpStatus::Eof
            } else {
                PumpStatus::Error("Unknown sample rate.".into())
            };
        }
    }
    let max_samples = (dst_rate as usize).saturating_mul(2);
    let queued = queue_mut(shared).len();
    if queued >= max_samples {
        return PumpStatus::Buffered;
    }
    let room = ((max_samples - queued) / 2).clamp(1, 4096);
    match fill_frames(active, dst_rate, rate, room) {
        Ok(produced) if !produced.is_empty() => {
            queue_mut(shared).extend(produced);
            PumpStatus::Pumped
        }
        Ok(_) if active.eof => {
            if loop_mode == LoopMode::Track {
                return match rewind(active) {
                    Ok(()) => {
                        shared.generation.fetch_add(1, Ordering::AcqRel);
                        shared.position.store(0f64.to_bits(), Ordering::Relaxed);
                        PumpStatus::Pumped
                    }
                    Err(err) => PumpStatus::Error(err),
                };
            }
            PumpStatus::Eof
        }
        Ok(_) => PumpStatus::Idle,
        Err(err) => PumpStatus::Error(err),
    }
}

fn fill_frames(active: &mut Active, dst_rate: u32, rate: f32, max_frames: usize) -> Result<Vec<f32>, String> {
    if max_frames == 0 {
        return Ok(Vec::new());
    }
    if active.sample_rate == 0 {
        decode_until_rate(active)?;
        if active.sample_rate == 0 {
            return Ok(Vec::new());
        }
    }
    let ratio = (active.sample_rate as f64 / dst_rate.max(1) as f64) * f64::from(rate.max(0.05));
    if !ratio.is_finite() || ratio <= 0.0 {
        return Err("Invalid playback rate.".into());
    }
    let alpha = if ratio > 1.05 {
        (1.0 / ratio) as f32
    } else {
        1.0
    };
    let filter = ratio > 1.05;
    let mut produced = Vec::<f32>::with_capacity(max_frames.saturating_mul(2));
    let mut packets = 0;
    while produced.len() / 2 < max_frames {
        while active.pending.len() / 2 < active.cursor.floor() as usize + 4 && !active.eof {
            packets += 1;
            if packets > 96 {
                break;
            }
            match decode_some(active) {
                Ok(true) => {}
                Ok(false) => active.eof = true,
                Err(err) => return Err(err),
            }
        }
        let frames = active.pending.len() / 2;
        let idx = active.cursor.floor() as usize;
        if idx >= frames || (idx + 2 >= frames && !active.eof) {
            break;
        }
        let (left, right) = hermite_at(&active.pending, active.cursor);
        let (left, right) = if filter {
            active.lp_left += alpha * (left - active.lp_left);
            active.lp_right += alpha * (right - active.lp_right);
            active.lp2_left += alpha * (active.lp_left - active.lp2_left);
            active.lp2_right += alpha * (active.lp_right - active.lp2_right);
            (active.lp2_left, active.lp2_right)
        } else {
            active.lp_left = left;
            active.lp_right = right;
            active.lp2_left = left;
            active.lp2_right = right;
            (left, right)
        };
        produced.push(left);
        produced.push(right);
        active.cursor += ratio;
        let drop_frames = active.cursor.floor() as usize;
        if drop_frames > 8 {
            let drop = drop_frames - 1;
            let drop_samples = drop * 2;
            if drop_samples <= active.pending.len() {
                active.pending.drain(..drop_samples);
                active.cursor -= drop as f64;
            }
        }
    }
    Ok(produced)
}

fn decode_until_rate(active: &mut Active) -> Result<(), String> {
    for _ in 0..40 {
        if active.sample_rate != 0 || active.eof {
            return Ok(());
        }
        if !decode_some(active)? {
            active.eof = true;
            return Ok(());
        }
    }
    Ok(())
}

fn decode_some(active: &mut Active) -> Result<bool, String> {
    let packet = match active.format.next_packet() {
        Ok(packet) => packet,
        Err(SymError::ResetRequired) => {
            active.decoder.reset();
            return Ok(true);
        }
        Err(SymError::IoError(err)) if err.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Ok(false);
        }
        Err(_) => return Ok(false),
    };
    if packet.track_id() != active.track_id {
        return Ok(true);
    }
    let decoded = match active.decoder.decode(&packet) {
        Ok(decoded) => decoded,
        Err(SymError::DecodeError(_)) => return Ok(true),
        Err(SymError::ResetRequired) => {
            active.decoder.reset();
            return Ok(true);
        }
        Err(err) => return Err(err.to_string()),
    };
    let spec = *decoded.spec();
    let channels = spec.channels.count().max(1);
    let frames = decoded.frames().max(decoded.capacity()).max(1);
    let needed = frames.saturating_mul(channels);
    let reuse = active
        .sample_buf
        .as_ref()
        .is_some_and(|buffer| buffer.capacity() >= needed && active.sample_channels == channels);
    if !reuse {
        active.sample_buf = Some(SampleBuffer::<f32>::new(frames as u64, spec));
        active.sample_channels = channels;
    }
    let samples = active.sample_buf.as_mut().expect("sample buffer");
    samples.copy_interleaved_ref(decoded);
    if active.sample_rate == 0 {
        active.sample_rate = spec.rate;
    }
    push_stereo(&mut active.pending, samples.samples(), channels);
    Ok(true)
}

fn push_stereo(pending: &mut VecDeque<f32>, samples: &[f32], channels: usize) {
    if channels == 0 {
        return;
    }
    if channels == 1 {
        for sample in samples {
            pending.push_back(*sample);
            pending.push_back(*sample);
        }
        return;
    }
    if channels == 2 {
        pending.extend(samples);
        return;
    }
    for frame in samples.chunks(channels) {
        pending.push_back(frame.first().copied().unwrap_or(0.0));
        pending.push_back(frame.get(1).copied().unwrap_or(0.0));
    }
}

fn frame_at(pending: &VecDeque<f32>, index: usize) -> Option<(f32, f32)> {
    Some((
        *pending.get(index * 2)?,
        *pending.get(index * 2 + 1)?,
    ))
}

fn hermite(y0: f32, y1: f32, y2: f32, y3: f32, t: f32) -> f32 {
    let c0 = y1;
    let c1 = 0.5 * (y2 - y0);
    let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    ((c3 * t + c2) * t + c1) * t + c0
}

fn hermite_at(pending: &VecDeque<f32>, position: f64) -> (f32, f32) {
    let frames = pending.len() / 2;
    if frames == 0 {
        return (0.0, 0.0);
    }
    let idx = position.floor() as isize;
    let t = (position - idx as f64) as f32;
    let frame = |offset: isize| -> (f32, f32) {
        let point = idx + offset;
        if point <= 0 {
            return frame_at(pending, 0).unwrap_or((0.0, 0.0));
        }
        if point as usize >= frames {
            return frame_at(pending, frames - 1).unwrap_or((0.0, 0.0));
        }
        frame_at(pending, point as usize).unwrap_or((0.0, 0.0))
    };
    let (left0, right0) = frame(-1);
    let (left1, right1) = frame(0);
    let (left2, right2) = frame(1);
    let (left3, right3) = frame(2);
    (
        hermite(left0, left1, left2, left3, t),
        hermite(right0, right1, right2, right3, t),
    )
}

fn clear_heard(shared: &Shared) {
    shared.generation.fetch_add(1, Ordering::AcqRel);
    queue_mut(shared).clear();
    spectrum_mut(shared).clear();
    let fade = shared.device_rate.load(Ordering::Relaxed).clamp(8_000, 192_000) / 80;
    shared.fade_left.store(fade.max(1), Ordering::Relaxed);
}

fn set_error(shared: &Shared, message: &str) {
    *lock_string(&shared.error) = message.to_string();
}

fn snapshot(shared: &Shared) -> PlaybackState {
    let track_id = lock_string(&shared.track_id).clone();
    let cover = lock_string(&shared.cover).clone();
    let error = lock_string(&shared.error).clone();
    let device_error = lock_string(&shared.device_error).clone();
    PlaybackState {
        track_id: if track_id.is_empty() { None } else { Some(track_id) },
        title: lock_string(&shared.title).clone(),
        artist: lock_string(&shared.artist).clone(),
        cover_path: if cover.is_empty() { None } else { Some(cover) },
        position: f64::from_bits(shared.position.load(Ordering::Relaxed)).max(0.0),
        duration: f64::from_bits(shared.duration.load(Ordering::Relaxed)).max(0.0),
        playing: shared.playing.load(Ordering::Relaxed),
        rate: f32::from_bits(shared.rate_bits.load(Ordering::Relaxed)),
        loop_mode: lock_string(&shared.loop_mode).clone(),
        index: shared.index.load(Ordering::Relaxed),
        queue_length: shared.queue_len.load(Ordering::Relaxed),
        error: if !error.is_empty() {
            Some(error)
        } else if !device_error.is_empty() {
            Some(device_error)
        } else {
            None
        },
    }
}

fn emit_state(app: &AppHandle, shared: &Shared) {
    let _ = app.emit("playback://state", snapshot(shared));
}

fn lock_string(slot: &Mutex<String>) -> MutexGuard<'_, String> {
    slot.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn lock_thread(slot: &Mutex<Option<thread::Thread>>) -> MutexGuard<'_, Option<thread::Thread>> {
    slot.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn try_queue(shared: &Shared) -> Option<MutexGuard<'_, VecDeque<f32>>> {
    match shared.playback.try_lock() {
        Ok(guard) => Some(guard),
        Err(TryLockError::WouldBlock) => None,
        Err(TryLockError::Poisoned(poison)) => Some(poison.into_inner()),
    }
}

fn render(shared: &Shared, frames: usize) -> Vec<(f32, f32)> {
    let mut out = vec![(0f32, 0f32); frames];
    let paused = shared.paused.load(Ordering::Relaxed) || !shared.has_track.load(Ordering::Relaxed);
    if paused || frames == 0 {
        return out;
    }
    let generation = shared.generation.load(Ordering::Acquire);
    let mut chunk = Vec::new();
    if let Some(mut queue) = try_queue(shared) {
        let samples = (frames * 2).min(queue.len() / 2 * 2);
        chunk.extend(queue.drain(..samples));
    }
    if shared.generation.load(Ordering::Acquire) != generation {
        return out;
    }
    let got = chunk.len() / 2;
    let gain = smooth_gain(shared, frames);
    let mut fade_left = shared.fade_left.load(Ordering::Relaxed);
    let fade_len = shared.device_rate.load(Ordering::Relaxed).clamp(8_000, 192_000) / 80;
    let fade_len = fade_len.max(1) as f32;
    for index in 0..got {
        let mut left = chunk[index * 2] * gain;
        let mut right = chunk[index * 2 + 1] * gain;
        if fade_left > 0 {
            let fade = (1.0 - fade_left as f32 / fade_len).clamp(0.0, 1.0);
            left *= fade;
            right *= fade;
            fade_left -= 1;
        }
        out[index] = (shape(left), shape(right));
    }
    shared.fade_left.store(fade_left, Ordering::Relaxed);
    if got > 0 {
        let rate = f64::from(f32::from_bits(shared.rate_bits.load(Ordering::Relaxed)));
        let dst = shared.device_rate.load(Ordering::Relaxed).max(1) as f64;
        let position = f64::from_bits(shared.position.load(Ordering::Relaxed));
        if shared.generation.load(Ordering::Acquire) == generation {
            shared
                .position
                .store((position + got as f64 * rate / dst).to_bits(), Ordering::Relaxed);
        }
        if let Ok(mut spectrum) = shared.spectrum.try_lock() {
            for (left, right) in out.iter().take(got) {
                spectrum.push_back((left + right) * 0.5);
            }
            while spectrum.len() > 4096 {
                spectrum.pop_front();
            }
        }
    }
    out
}

fn finite_unit(value: f32, fallback: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        fallback
    }
}

fn finite_track_gain(value: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 2.0)
    } else {
        1.0
    }
}

fn shape(sample: f32) -> f32 {
    if sample.is_finite() {
        sample.clamp(-1.0, 1.0)
    } else {
        0.0
    }
}

fn queue_mut(shared: &Shared) -> MutexGuard<'_, VecDeque<f32>> {
    shared.playback.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn spectrum_mut(shared: &Shared) -> MutexGuard<'_, VecDeque<f32>> {
    shared
        .spectrum
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
}

fn smooth_gain(shared: &Shared, frames: usize) -> f32 {
    let master = finite_unit(f32::from_bits(shared.volume_bits.load(Ordering::Relaxed)), 1.0);
    let track = finite_track_gain(f32::from_bits(shared.track_gain_bits.load(Ordering::Relaxed)));
    let target = master * track;
    let current = f32::from_bits(shared.gain_bits.load(Ordering::Relaxed));
    let step = (frames as f32 * 0.000_35).clamp(0.02, 0.25);
    let next = current + (target - current).clamp(-step, step);
    shared.gain_bits.store(next.to_bits(), Ordering::Relaxed);
    next
}

fn write_f32(data: &mut [f32], channels: usize, shared: &Shared) {
    let channels = channels.max(1);
    let frames = data.len() / channels;
    let rendered = render(shared, frames);
    for (frame, (left, right)) in rendered.iter().enumerate() {
        let base = frame * channels;
        if channels == 1 {
            data[base] = (left + right) * 0.5;
        } else {
            data[base] = *left;
            data[base + 1] = *right;
            for channel in 2..channels {
                data[base + channel] = 0.0;
            }
        }
    }
}

fn write_i16(data: &mut [i16], channels: usize, shared: &Shared) {
    let channels = channels.max(1);
    let frames = data.len() / channels;
    let rendered = render(shared, frames);
    for (frame, (left, right)) in rendered.iter().enumerate() {
        let base = frame * channels;
        if channels == 1 {
            data[base] = to_i16((left + right) * 0.5);
        } else {
            data[base] = to_i16(*left);
            data[base + 1] = to_i16(*right);
            for channel in 2..channels {
                data[base + channel] = 0;
            }
        }
    }
}

fn write_u16(data: &mut [u16], channels: usize, shared: &Shared) {
    let channels = channels.max(1);
    let frames = data.len() / channels;
    let rendered = render(shared, frames);
    for (frame, (left, right)) in rendered.iter().enumerate() {
        let base = frame * channels;
        if channels == 1 {
            data[base] = to_u16((left + right) * 0.5);
        } else {
            data[base] = to_u16(*left);
            data[base + 1] = to_u16(*right);
            for channel in 2..channels {
                data[base + channel] = to_u16(0.0);
            }
        }
    }
}

fn to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

fn to_u16(sample: f32) -> u16 {
    ((sample.clamp(-1.0, 1.0) * 0.5 + 0.5) * u16::MAX as f32) as u16
}

fn mark_music_stream() {
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("PULSE_PROP_media.role", "music");
        std::env::set_var("PULSE_PROP_media.name", "Orfeus");
        std::env::set_var("PULSE_PROP_application.name", "Orfeus");
        std::env::set_var("PULSE_PROP_application.icon_name", "orfeus");
        std::env::set_var("PULSE_PROP_application.process.binary", "orfeus");
    }
}

fn spawn_output(shared: Arc<Shared>) -> u32 {
    let (tx, rx) = mpsc::channel();
    let shared_out = shared.clone();
    thread::Builder::new()
        .name("orfeus-output".into())
        .spawn(move || {
            *lock_thread(&shared_out.output_thread) = Some(thread::current());
            let mut announced = false;
            loop {
                shared_out.output_broken.store(false, Ordering::Release);
                match open_stream(shared_out.clone()) {
                    Ok((stream, rate)) => {
                        shared_out.device_rate.store(rate, Ordering::Relaxed);
                        if !announced {
                            let _ = tx.send(Ok(rate));
                            announced = true;
                        }
                        while !shared_out.output_broken.load(Ordering::Acquire) {
                            thread::park_timeout(Duration::from_millis(250));
                        }
                        drop(stream);
                        thread::sleep(Duration::from_millis(200));
                    }
                    Err(err) => {
                        if !announced {
                            let _ = tx.send(Err(err));
                            return;
                        }
                        *lock_string(&shared_out.device_error) = err;
                        thread::sleep(Duration::from_secs(1));
                    }
                }
            }
        })
        .expect("output thread");
    match rx.recv() {
        Ok(Ok(rate)) => rate,
        Ok(Err(err)) => {
            *lock_string(&shared.device_error) = err;
            48_000
        }
        Err(_) => {
            *lock_string(&shared.device_error) = "Could not open audio.".into();
            48_000
        }
    }
}

fn open_stream(shared: Arc<Shared>) -> Result<(Stream, u32), String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("No audio device found.")?;
    let supported = device.default_output_config().map_err(|err| err.to_string())?;
    let sample_format = supported.sample_format();
    let rate = supported.sample_rate().0;
    let channels = supported.channels() as usize;
    let preferred = stream_config(&supported, false);
    let fixed = stream_config(&supported, true);
    let stream = match start_stream(&device, &preferred, sample_format, channels, shared.clone()) {
        Ok(stream) => stream,
        Err(_) => start_stream(&device, &fixed, sample_format, channels, shared)?,
    };
    stream.play().map_err(|err| err.to_string())?;
    Ok((stream, rate))
}

fn stream_config(supported: &cpal::SupportedStreamConfig, fixed: bool) -> StreamConfig {
    let mut config: StreamConfig = supported.clone().into();
    if fixed {
        if let SupportedBufferSize::Range { min, max } = *supported.buffer_size() {
            config.buffer_size = BufferSize::Fixed(4096u32.clamp(min, max));
        }
    }
    config
}

fn start_stream(
    device: &cpal::Device,
    config: &StreamConfig,
    sample_format: SampleFormat,
    channels: usize,
    shared: Arc<Shared>,
) -> Result<Stream, String> {
    let err = {
        let shared = shared.clone();
        move |error: cpal::StreamError| {
            if shared.output_broken.swap(true, Ordering::AcqRel) {
                return;
            }
            eprintln!("orfeus audio: {error}");
            if let Some(worker) = lock_thread(&shared.output_thread).as_ref() {
                worker.unpark();
            }
        }
    };
    match sample_format {
        SampleFormat::F32 => device
            .build_output_stream(
                config,
                {
                    let shared = shared.clone();
                    move |data: &mut [f32], _| {
                        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            write_f32(data, channels, &shared)
                        }))
                        .is_err()
                        {
                            data.fill(0.0);
                        }
                    }
                },
                err,
                None,
            )
            .map_err(|error| error.to_string()),
        SampleFormat::I16 => device
            .build_output_stream(
                config,
                {
                    let shared = shared.clone();
                    move |data: &mut [i16], _| {
                        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            write_i16(data, channels, &shared)
                        }))
                        .is_err()
                        {
                            data.fill(0);
                        }
                    }
                },
                err,
                None,
            )
            .map_err(|error| error.to_string()),
        SampleFormat::U16 => device
            .build_output_stream(
                config,
                {
                    let shared = shared.clone();
                    move |data: &mut [u16], _| {
                        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            write_u16(data, channels, &shared)
                        }))
                        .is_err()
                        {
                            data.fill(to_u16(0.0));
                        }
                    }
                },
                err,
                None,
            )
            .map_err(|error| error.to_string()),
        other => Err(format!("Unsupported sample format: {other}")),
    }
}

fn spectrum_loop(shared: Arc<Shared>, app: AppHandle) {
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(2048);
    let mut smoothed = [0f32; 64];
    loop {
        if !shared.playing.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(250));
            continue;
        }
        thread::sleep(Duration::from_millis(24));
        let window = match shared.spectrum.try_lock() {
            Ok(guard) if guard.len() >= 2048 => {
                let start = guard.len() - 2048;
                guard.iter().skip(start).copied().collect::<Vec<_>>()
            }
            Ok(_) => Vec::new(),
            Err(TryLockError::WouldBlock) => Vec::new(),
            Err(TryLockError::Poisoned(poison)) => {
                let guard = poison.into_inner();
                if guard.len() >= 2048 {
                    let start = guard.len() - 2048;
                    guard.iter().skip(start).copied().collect()
                } else {
                    Vec::new()
                }
            }
        };
        let playing = shared.playing.load(Ordering::Relaxed);
        if playing && window.len() == 2048 {
            let bands = analyze(&fft, &window);
            for (slot, band) in smoothed.iter_mut().zip(bands) {
                let follow = if band >= *slot { 0.82 } else { 0.46 };
                *slot += (band - *slot) * follow;
            }
        } else {
            for slot in &mut smoothed {
                *slot *= 0.72;
            }
        }
        let _ = app.emit("playback://spectrum", smoothed.as_slice());
    }
}

fn analyze(fft: &Arc<dyn Fft<f32>>, window: &[f32]) -> [f32; 64] {
    let mut buffer: Vec<Complex<f32>> = window
        .iter()
        .enumerate()
        .map(|(index, sample)| {
            let weight = 0.5
                - 0.5
                    * (std::f32::consts::TAU * index as f32 / (window.len() as f32 - 1.0)).cos();
            Complex {
                re: sample * weight,
                im: 0.0,
            }
        })
        .collect();
    fft.process(&mut buffer);
    let mags: Vec<f32> = buffer[1..buffer.len() / 2]
        .iter()
        .map(|value| value.norm())
        .collect();
    bands_from(&mags)
}

fn bands_from(mags: &[f32]) -> [f32; 64] {
    let mut bands = [0f32; 64];
    if mags.is_empty() {
        return bands;
    }
    let peak = mags.iter().copied().fold(0f32, f32::max).max(0.000_1);
    let energy = (mags.iter().sum::<f32>() / mags.len() as f32 / 6.0).clamp(0.0, 1.0);
    let bins = mags.len();
    for (index, band) in bands.iter_mut().enumerate() {
        let start = ((index as f32 / 64.0).powi(2) * (bins - 1) as f32) as usize;
        let end = ((((index + 1) as f32 / 64.0).powi(2) * (bins - 1) as f32) as usize)
            .max(start + 1)
            .min(bins);
        let avg = mags[start..end].iter().sum::<f32>() / (end - start) as f32;
        let loud = (avg / peak).powf(0.62);
        let presence = energy.sqrt().max(0.42);
        *band = (loud * presence).clamp(0.0, 1.0);
    }
    bands
}

#[cfg(test)]
mod tests {
    use super::{ease_in_out, hermite, mix_crossfade};

    #[test]
    fn hermite_passes_through_the_current_sample() {
        let sample = hermite(0.0, 0.4, 0.8, 1.0, 0.0);
        assert!((sample - 0.4).abs() < 0.000_1);
    }

    #[test]
    fn crossfade_eases_out_of_the_old_track_and_into_the_new_one() {
        assert!((ease_in_out(0.0) - 0.0).abs() < 0.000_1);
        assert!((ease_in_out(0.5) - 0.5).abs() < 0.000_1);
        assert!((ease_in_out(1.0) - 1.0).abs() < 0.000_1);
        assert!(ease_in_out(0.2) < 0.2);
        assert!(ease_in_out(0.8) > 0.8);
        let outgoing = [1.0, 1.0, 1.0, 1.0];
        let incoming = [0.5, -0.5, 0.5, -0.5];
        let mixed = mix_crossfade(&outgoing, &incoming, 0, 2);
        assert!((mixed[0] - 1.0).abs() < 0.000_1);
        assert!((mixed[2] - 0.5).abs() < 0.000_1);
        assert!((mixed[3] + 0.5).abs() < 0.000_1);
    }
}
