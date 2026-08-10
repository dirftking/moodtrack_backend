$env:Path = 'C:\Users\Drift king\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Users\Drift king\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\override;C:\Users\Drift king\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;' + $env:Path

& 'C:\Users\Drift king\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' dlx wrangler tunnel quick-start http://127.0.0.1:5173
