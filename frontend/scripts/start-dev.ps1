$env:Path = 'C:\Users\Drift king\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Users\Drift king\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\override;C:\Users\Drift king\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;' + $env:Path

Set-Location 'C:\Users\Drift king\Desktop\Moodtrack\moodtrack\frontend'
& 'C:\Users\Drift king\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' dev --host 127.0.0.1
