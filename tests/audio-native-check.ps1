param([string]$RuntimePath)
$ErrorActionPreference='Stop'
$compileTemp=Join-Path $RuntimePath 'compiler-temp'
New-Item -ItemType Directory -Force -Path $compileTemp | Out-Null
$env:TEMP=$env:TMP=(Resolve-Path -LiteralPath $compileTemp).Path
$core=Join-Path $RuntimePath 'naudio.core/lib/netstandard2.0/NAudio.Core.dll'
$wasapi=Join-Path $RuntimePath 'naudio.wasapi/lib/netstandard2.0/NAudio.Wasapi.dll'
[Reflection.Assembly]::LoadFrom($core)|Out-Null
[Reflection.Assembly]::LoadFrom($wasapi)|Out-Null
$standard=[Reflection.Assembly]::Load('netstandard, Version=2.0.0.0, Culture=neutral, PublicKeyToken=cc7b13ffcd2ddd51').Location
Add-Type -Path (Join-Path $PSScriptRoot '../src/main/audio/AudioHost.cs') -ReferencedAssemblies @($core,$wasapi,$standard)
function Check($value,$message){if(-not $value){throw $message}}
$a=[AudioTimeline]::new()
$b=[AudioTimeline]::new()
$a.Add([float[]]@(0.8,0.4,0.6,0.2),4,2)
$b.Add([float[]]@(0.2,0.4,0.2,0.6),4,2)
$left=[float[]]::new(6)
$right=[float[]]::new(6)
$a.Read(0,$left,3)
$b.Read(0,$right,3)
Check ([Math]::Abs([AudioTimeline]::Mix($left[0],$right[0])-16383)-le 1) 'mix must contain both sources'
Check ($left[4]-eq 0 -and $right[4]-eq 0) 'missing audio must be silence'
Check ([AudioTimeline]::Mix(2,2)-eq 32767) 'mix clipping bound'
Check ([DeskIslandAudio]::PcmLevel([byte[]]::new(8),8)-eq 0) 'silent PCM must produce a flat meter'
Check ([DeskIslandAudio]::PcmLevel([byte[]]@(),0)-eq 0) 'empty meter must be safe'
Check ([Math]::Abs([DeskIslandAudio]::PcmLevel([byte[]]@(0,64,0,192),4)-0.5)-lt 0.00001) 'meter must measure positive and negative PCM equally'
Check ([Math]::Abs([DeskIslandAudio]::PcmLevel([byte[]]@(0,64,0,0),4)-[Math]::Sqrt(0.125))-lt 0.00001) 'meter must follow recorded sample energy'
$a.Add([float[]]@(1,1),2,96002)
$a.Read(0,$left,1)
Check ($left[0]-eq 0) 'old ring slots must not replay'
$wave=[NAudio.Wave.BufferedWaveProvider]::new([NAudio.Wave.WaveFormat]::CreateIeeeFloatWaveFormat(48000,2))
$provider=[NAudio.Wave.SampleProviders.WaveToSampleProvider]::new($wave)
$stereo=[Activator]::CreateInstance([DeskIslandAudio].Assembly.GetType('StereoSource'),[object[]]@($provider))
Check ($stereo.Read([float[]]::new(0),0,0)-eq 0) 'zero-byte packets must not enter the float converter'
$previous=[Collections.Generic.Dictionary[NAudio.CoreAudioApi.Role,string]]::new()
foreach($role in @('Console','Multimedia','Communications')){$previous[[NAudio.CoreAudioApi.Role]::$role]='old-'+$role}
$calls=[Collections.Generic.List[string]]::new()
$apply=[Action[string,NAudio.CoreAudioApi.Role]]{param($id,$role);$calls.Add($id);if($id-eq 'new' -and $role-eq [NAudio.CoreAudioApi.Role]::Multimedia){throw 'failure'}}
try{[DeskIslandAudio]::SetRoles('new',$previous,$apply);throw 'expected switch error'}catch{Check ($calls.Contains('old-Console') -and $calls.Contains('old-Multimedia') -and $calls.Contains('old-Communications')) 'restore every original role'}
Write-Output 'AUDIO_NATIVE_LOGIC_PASSED'
