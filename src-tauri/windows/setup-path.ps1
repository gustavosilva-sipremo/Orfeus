param([string]$Dir)
$old = [Environment]::GetEnvironmentVariable("Path", "User")
if ($null -eq $old) { $old = "" }
$clean = @()
foreach ($part in ($old -split ";")) {
    if ([string]::IsNullOrWhiteSpace($part)) { continue }
    if ($part.TrimEnd("\") -ieq $Dir.TrimEnd("\")) { continue }
    $clean += $part
}
$clean += $Dir
[Environment]::SetEnvironmentVariable("Path", ($clean -join ";"), "User")
Add-Type -Namespace Orfeus -Name Env -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true, CharSet=System.Runtime.InteropServices.CharSet.Auto)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, int Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
"@
$result = [UIntPtr]::Zero
[Orfeus.Env]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$result) | Out-Null
