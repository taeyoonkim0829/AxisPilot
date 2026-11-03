# Exports STEP files from the Festo PARTdataManager by driving its window (search the part number, open the first
# result, 파일로 내보내기 → STEP). The free Festo edition runs no own scripts, so this clicks like a user would.
#   powershell -File scripts/festo-cad/export-gui.ps1 -List missing.csv [-Out C:\Users\…\Documents\FestoCAD] [-Priority 1] [-Kind axes] [-Max 10]
# Before: PARTdataManager open and maximised, STEP picked once in 파일로 내보내기 ▸ 3D 시스템 중립 ▸ STEP (the
# toolbar button then reads "STEP"). Do not use the PC while it runs. Files already in -Out are skipped, so a
# stopped run continues where it ended. Results go to <Out>\export-log.csv; then run import.mjs on <Out>.
# Screen positions below were measured on a 3440×1440 screen at 100 % scaling; re-measure on another layout.
param(
  [Parameter(Mandatory)] [string]$List,
  [string]$Out = "$env:USERPROFILE\Documents\FestoCAD",
  [int]$Priority = 0,
  [string]$Kind = '',
  [int]$Max = 0,
  [int]$OpenWait = 7000
)

$pos = @{
  search    = 225, 97     # search box
  result    = 1190, 280   # first search result row (right of the filter panel)
  export    = 340, 62     # toolbar export button (after STEP was chosen once), not its drop-down arrow
}
# in the STEP export dialog, from its top left corner (it opens at varying heights)
$dialogPos = @{ target = 386, 110; ok = 606, 189 }

Add-Type -AssemblyName System.Windows.Forms, UIAutomationClient, UIAutomationTypes
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class U {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
}
'@
[U]::SetProcessDPIAware() | Out-Null

function Focus {
  $p = Get-Process pdatamgr -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $p) { throw 'PARTdataManager is not running' }
  $h = $p.MainWindowHandle
  # Windows only lets the foreground thread hand the focus on: borrow its input queue (works from a background shell)
  $fg = [U]::GetWindowThreadProcessId([U]::GetForegroundWindow(), [IntPtr]::Zero)
  $me = [U]::GetCurrentThreadId()
  $attached = $fg -ne $me -and [U]::AttachThreadInput($me, $fg, $true)
  [U]::ShowWindow($h, 3) | Out-Null
  [U]::BringWindowToTop($h) | Out-Null
  [U]::SetForegroundWindow($h) | Out-Null
  if ($attached) { [U]::AttachThreadInput($me, $fg, $false) | Out-Null }
  Start-Sleep -Milliseconds 300
  # never click or type into another window (Windows may refuse to bring PARTdataManager forward)
  if ([U]::GetForegroundWindow() -ne $p.MainWindowHandle -or -not [U]::IsZoomed($p.MainWindowHandle)) {
    throw 'PARTdataManager is not the maximised foreground window'
  }
}
function Click($xy, [switch]$Double) {
  [U]::SetCursorPos($xy[0], $xy[1]) | Out-Null
  Start-Sleep -Milliseconds 80
  [U]::mouse_event(2, 0, 0, 0, 0); [U]::mouse_event(4, 0, 0, 0, 0)
  if ($Double) { Start-Sleep -Milliseconds 80; [U]::mouse_event(2, 0, 0, 0, 0); [U]::mouse_event(4, 0, 0, 0, 0) }
}
function Send([string]$keys) { [System.Windows.Forms.SendKeys]::SendWait($keys) }
function Literal([string]$s) { $s -replace '([+^%~(){}\[\]])', '{$1}' }
$A = [System.Windows.Automation.AutomationElement]
# dialogs are child windows of the main window; returns the rectangle (x, y, width, height) of the one whose
# title matches, or $null
function Dialog([string]$Title = 'STEP*') {
  $p = Get-Process pdatamgr | Select-Object -First 1
  $main = $A::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, $p.Id)))
  if (-not $main) { return $null }
  $d = $main.FindFirst([System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)))
  if (-not $d -or $d.Current.Name -notlike $Title) { return $null }
  $r = $d.Current.BoundingRectangle
  , @([int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
}
function At($corner, $offset) { , @(($corner[0] + $offset[0]), ($corner[1] + $offset[1])) }
function FirstProduct([string]$file) {
  # the PRODUCT entities can sit anywhere in the DATA section
  $text = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::ASCII)
  if ($text -match "PRODUCT\('([^']*)'") { $Matches[1] } else { '' }
}

New-Item -ItemType Directory -Force $Out | Out-Null
$log = Join-Path $Out 'export-log.csv'
if (-not (Test-Path $log)) { 'time,partNumber,model,result,product,seconds' | Out-File $log -Encoding utf8 }

$rows = Import-Csv $List | Where-Object {
  $_.partNumber -and (-not $Priority -or [int]$_.priority -eq $Priority) -and (-not $Kind -or $_.kind -eq $Kind)
}
# one export per part number (module numbers stand for several axis variants)
$rows = $rows | Group-Object partNumber | ForEach-Object { $_.Group[0] }
if ($Max) { $rows = $rows | Select-Object -First $Max }
Write-Host "$(@($rows).Count) parts to export into $Out"

$done = 0
foreach ($r in $rows) {
  $file = Join-Path $Out "$($r.partNumber).stp"
  if (Test-Path $file) { continue }
  $t0 = Get-Date
  $result = 'ok'; $product = ''
  try {
    Focus
    Send '{ESC}{ESC}'
    Click $pos.search; Start-Sleep -Milliseconds 150
    Send '^a'; Send (Literal $r.partNumber); Send '{ENTER}'
    Start-Sleep -Milliseconds 3500
    Click $pos.result -Double
    Start-Sleep -Milliseconds 1500
    # a discontinued part asks whether to open it or its successor (the only dialog opening a part brings up; its
    # title is Korean, which Windows PowerShell would misread here): pick the part itself (left tile), then open
    $old = Dialog '*'
    if ($old) {
      Click @(($old[0] + [int]($old[2] * 0.24)), ($old[1] + [int]($old[3] * 0.48))); Start-Sleep -Milliseconds 400
      Click @(($old[0] + $old[2] - 62), ($old[1] + $old[3] - 29))
      $result = 'ok (discontinued)'
    }
    Start-Sleep -Milliseconds $OpenWait

    $dlg = $null
    for ($try = 0; $try -lt 3 -and -not $dlg; $try++) {
      Focus
      Click $pos.export
      for ($i = 0; $i -lt 20 -and -not ($dlg = Dialog); $i++) { Start-Sleep -Milliseconds 250 }
    }
    if (-not $dlg) { throw 'export dialog did not open' }

    Click (At $dlg $dialogPos.target); Start-Sleep -Milliseconds 150
    Send '^a'; Send (Literal $file)
    Start-Sleep -Milliseconds 200
    Click (At $dlg $dialogPos.ok)

    $last = -1
    for ($i = 0; $i -lt 240; $i++) {
      Start-Sleep -Milliseconds 500
      if (Test-Path $file) {
        $len = (Get-Item $file).Length
        if ($len -gt 0 -and $len -eq $last) { break }
        $last = $len
      }
    }
    if (-not (Test-Path $file)) { throw 'no file written' }
    $product = FirstProduct $file
    if ($product -notlike "$($r.partNumber) *") { $result = 'other part' }
  } catch {
    $result = "failed: $($_.Exception.Message)"
    if ($result -like '*foreground*') {
      "$(Get-Date -Format s),$($r.partNumber),""$($r.model)"",""$result"","""",0" | Out-File $log -Append -Encoding utf8
      Write-Host "stopped: $result"
      break
    }
    Send '{ESC}{ESC}'
  }
  $sec = [int]((Get-Date) - $t0).TotalSeconds
  "$(Get-Date -Format s),$($r.partNumber),""$($r.model)"",""$result"",""$product"",$sec" | Out-File $log -Append -Encoding utf8
  $done++
  Write-Host "[$done] $($r.partNumber) $($r.model): $result ($sec s)"
}
Write-Host "finished; log: $log"
