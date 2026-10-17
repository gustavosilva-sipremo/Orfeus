!include LogicLib.nsh
!include nsDialogs.nsh

Var ToolsDialog
Var PythonBox
Var FfmpegBox
Var XorrisoBox
Var InstallPython
Var InstallFfmpeg
Var InstallXorriso
Var PythonMissing
Var FfmpegMissing
Var XorrisoMissing

!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_LICENSE "${__FILEDIR__}\terms.rtf"
!ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
!endif
!ifdef MUI_ICON
  !undef MUI_ICON
!endif
!ifdef MUI_UNICON
  !undef MUI_UNICON
!endif
Icon "${__FILEDIR__}\..\icons\icon.ico"
UninstallIcon "${__FILEDIR__}\..\icons\icon.ico"

Page custom ToolsPageCreate ToolsPageLeave

Function ToolsPageCreate
  StrCpy $PythonMissing 1
  StrCpy $FfmpegMissing 1
  StrCpy $XorrisoMissing 1
  nsExec::ExecToStack 'cmd.exe /d /c py -3 -c "import encodings"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    nsExec::ExecToStack 'cmd.exe /d /c python -c "import encodings"'
    Pop $0
    Pop $1
  ${EndIf}
  ${If} $0 == 0
    StrCpy $PythonMissing 0
  ${EndIf}
  nsExec::ExecToStack 'cmd.exe /d /c where ffmpeg'
  Pop $0
  Pop $1
  ${If} $0 == 0
    StrCpy $FfmpegMissing 0
  ${EndIf}
  nsExec::ExecToStack 'cmd.exe /d /c where xorriso'
  Pop $0
  Pop $1
  ${If} $0 == 0
    StrCpy $XorrisoMissing 0
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Tools" "Orfeus installs only what this PC is missing."
  nsDialogs::Create 1018
  Pop $ToolsDialog
  ${If} $ToolsDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 36u "Music playback needs WebView2, which this setup downloads if it is missing. YouTube import needs Python and FFmpeg on PATH. Burning a CD or DVD needs xorriso."
  Pop $0
  ${If} $PythonMissing == 1
    ${NSD_CreateCheckbox} 0 40u 100% 14u "Install Python and add it to PATH"
    Pop $PythonBox
    ${NSD_SetState} $PythonBox ${BST_CHECKED}
  ${Else}
    ${NSD_CreateLabel} 0 40u 100% 14u "Python is already installed."
    Pop $0
  ${EndIf}
  ${If} $FfmpegMissing == 1
    ${NSD_CreateCheckbox} 0 58u 100% 14u "Install FFmpeg and add it to PATH"
    Pop $FfmpegBox
    ${NSD_SetState} $FfmpegBox ${BST_CHECKED}
  ${Else}
    ${NSD_CreateLabel} 0 58u 100% 14u "FFmpeg is already installed."
    Pop $0
  ${EndIf}
  ${If} $XorrisoMissing == 1
    ${NSD_CreateCheckbox} 0 76u 100% 14u "Install xorriso and add it to PATH"
    Pop $XorrisoBox
    ${NSD_SetState} $XorrisoBox ${BST_CHECKED}
  ${Else}
    ${NSD_CreateLabel} 0 76u 100% 14u "xorriso is already installed."
    Pop $0
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function ToolsPageLeave
  StrCpy $InstallPython 0
  StrCpy $InstallFfmpeg 0
  StrCpy $InstallXorriso 0
  ${If} $PythonMissing == 1
    ${NSD_GetState} $PythonBox $InstallPython
  ${EndIf}
  ${If} $FfmpegMissing == 1
    ${NSD_GetState} $FfmpegBox $InstallFfmpeg
  ${EndIf}
  ${If} $XorrisoMissing == 1
    ${NSD_GetState} $XorrisoBox $InstallXorriso
  ${EndIf}
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  ${If} $FfmpegMissing == 0
    Delete "$INSTDIR\runtime\ffmpeg.exe"
  ${EndIf}
  ${If} $InstallXorriso != ${BST_CHECKED}
    Delete "$INSTDIR\runtime\xorriso.exe"
    Delete "$INSTDIR\runtime\xorriso-GPL-3.0.txt"
    Delete "$INSTDIR\runtime\xorriso-source.txt"
  ${EndIf}
  ${If} $InstallFfmpeg == ${BST_CHECKED}
  ${OrIf} $InstallXorriso == ${BST_CHECKED}
    nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\runtime\setup-path.ps1" -Dir "$INSTDIR\runtime"'
  ${EndIf}
  ${If} $PythonMissing == 0
    Delete "$INSTDIR\runtime\python-installer.exe"
  ${EndIf}
  ${If} $InstallPython == ${BST_CHECKED}
    IfFileExists "$INSTDIR\runtime\python-installer.exe" 0 OrfeusPythonMissing
      ExecWait '"$INSTDIR\runtime\python-installer.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_test=0 Shortcuts=0'
      Delete "$INSTDIR\runtime\python-installer.exe"
      Goto OrfeusPythonDone
    OrfeusPythonMissing:
      MessageBox MB_OK "The Python installer was not included in this setup."
    OrfeusPythonDone:
  ${EndIf}
!macroend
