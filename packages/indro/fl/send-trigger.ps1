$ErrorActionPreference = 'Stop'

if ($args.Count -ne 1 -or $args[0] -ne 'FL-Granulizer-Bridge') {
  throw 'Exact MIDI endpoint name is required.'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class IndroMidi {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  public struct Caps {
    public ushort mid;
    public ushort pid;
    public uint driverVersion;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string name;
    public ushort technology;
    public ushort voices;
    public ushort notes;
    public ushort channelMask;
    public uint support;
  }
  [DllImport("winmm.dll")] public static extern uint midiOutGetNumDevs();
  [DllImport("winmm.dll", CharSet = CharSet.Auto)] public static extern uint midiOutGetDevCaps(UIntPtr id, out Caps caps, uint size);
  [DllImport("winmm.dll")] public static extern uint midiOutOpen(out IntPtr handle, uint id, IntPtr callback, IntPtr instance, uint flags);
  [DllImport("winmm.dll")] public static extern uint midiOutShortMsg(IntPtr handle, uint message);
  [DllImport("winmm.dll")] public static extern uint midiOutClose(IntPtr handle);
}
'@

$matches = @()
for ($id = 0; $id -lt [IndroMidi]::midiOutGetNumDevs(); $id++) {
  $caps = New-Object IndroMidi+Caps
  $result = [IndroMidi]::midiOutGetDevCaps([UIntPtr]::new([uint64]$id), [ref]$caps, [Runtime.InteropServices.Marshal]::SizeOf($caps))
  if ($result -eq 0 -and $caps.name -eq $args[0]) { $matches += $id }
}
if ($matches.Count -ne 1) { throw "Expected one exact MIDI output endpoint; found $($matches.Count)." }

$handle = [IntPtr]::Zero
$opened = [IndroMidi]::midiOutOpen([ref]$handle, [uint32]$matches[0], [IntPtr]::Zero, [IntPtr]::Zero, 0)
if ($opened -ne 0) { throw "midiOutOpen failed: $opened" }
try {
  $message = [uint32](0xBF -bor (118 -shl 8) -bor (127 -shl 16))
  $sent = [IndroMidi]::midiOutShortMsg($handle, $message)
  if ($sent -ne 0) { throw "midiOutShortMsg failed: $sent" }
  Start-Sleep -Milliseconds 100
  [pscustomobject]@{ endpoint = $args[0]; submitted = $true } | ConvertTo-Json -Compress
} finally {
  [void][IndroMidi]::midiOutClose($handle)
}
