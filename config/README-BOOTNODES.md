# Bootnodes format

- Put **one enode per line** in `config\bootnodes.txt`.
- Lines starting with `#` are comments.
- Do not scan IP ranges. Only use bootnodes from trusted Ethernova sources.
- If `autoExportEnabled=true`, the collector will overwrite `bootnodes.txt` on its schedule.

Example:

```
enode://PUBKEY@IP:PORT?discport=PORT
```



