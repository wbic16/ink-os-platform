# App hostname

Every deployed app runs its own HTTP server, bound to an ephemeral
loopback port on the host. Browsers on other machines can never use
those loopback URLs, so when an instance is reachable beyond the host
it needs one public hostname surface for app windows:

```sh
INK_OS_APP_HOSTNAME=apps.example.com npm start
```

Accepted forms are a bare hostname (`apps.example.com`), with a port
(`apps.example.com:8443`), or with a scheme (`https://apps.example.com`,
`https://apps.example.com:8443`). Anything else — a path, query,
fragment or credentials — is rejected at startup. Without an explicit
port, the main server's port is used. The provider derives a
per-release origin from the hostname:

- App windows are handed `SCHEME://RELEASE.apps.example.com` URLs and
  the main server proxies their traffic, matched by the `Host` header,
  to the app's internal loopback server. Loopback URLs never reach
  the browser once a public origin is configured.
- Per-release subdomains keep every app on its own origin, separate
  from the shell's origin — the desktop enforces this isolation
  (`launch.origin !== location.origin`), so apps cannot be folded
  onto the shell's hostname or a path beneath it.
- Internal app servers keep binding loopback only; the public
  hostname is a routing surface, not a new listener.

DNS requirement: one wildcard record under a name the operator
controls — `*.apps.example.com` pointing at the host (or at whatever
fronts it). No other records are needed, however many apps deploy.

HTTPS: terminate TLS in front of the instance (a reverse proxy, a
tunnel, a platform edge) and put `https` in the config — the scheme
in the config is exactly what browsers are told, and app session
cookies pick up `Secure` from it automatically.

`INK_OS_APP_ORIGIN_TEMPLATE` remains available for shapes a single
hostname cannot express; when both are set, the template wins and the
hostname is ignored (a note is logged). With neither set and the
server bound to a non-loopback address, startup prints a warning,
because app windows will otherwise be handed loopback URLs that only
work on the host itself.
