# Generates one WAV per scene from video/script.json using the offline Windows Hindi voice (hi-IN).
# Usage: powershell -ExecutionPolicy Bypass -File video\tts.ps1
param([string]$Lang = 'hi-IN', [double]$Rate = 1.05)
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $dir 'audio'
New-Item -ItemType Directory -Force $out | Out-Null

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }

$voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -eq $Lang } | Select-Object -First 1
if (-not $voice) { Write-Output "NO_VOICE: no $Lang voice installed"; exit 2 }
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$synth.Voice = $voice
$synth.Options.SpeakingRate = $Rate
Write-Output "voice: $($voice.DisplayName)"

$scenes = Get-Content -Raw -Encoding UTF8 (Join-Path $dir 'script.json') | ConvertFrom-Json
foreach ($s in $scenes) {
  $stream = Await ($synth.SynthesizeTextToStreamAsync($s.text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
  $null = Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32])
  $bytes = New-Object byte[] ([int]$stream.Size)
  $reader.ReadBytes($bytes)
  [IO.File]::WriteAllBytes((Join-Path $out "$($s.id).wav"), $bytes)
  Write-Output "$($s.id).wav"
}
