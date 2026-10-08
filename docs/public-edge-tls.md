# Public-edge TLS

When an operator places nginx or another HTTPS proxy in front of Caddy, there are two TLS hops:

1. The browser connects to the edge with a certificate valid for the public hostname. Configure HSTS at that edge only after the HTTPS route is stable.
2. The edge connects to the intended Caddy stack using HTTPS. Caddy may use `tls internal` for the configured `ATHENA_PRIVATE_HOSTNAME`.

Do not treat an unverified inner hop (`proxy_ssl_verify off`) as end-to-end TLS. Configure certificate verification before relying on that hop, or keep the service private and unexposed while staging.

## Enabling inner verification

For each independently configured edge target:

- Export only that Caddy stack's **public** root certificate with `sh scripts/docker/export-caddy-root-ca.sh .env.docker.prod`. Never copy its private root key. Verify the root fingerprint through an independent trusted channel before installing it on the edge.
- Configure the edge's trusted CA path, enable upstream certificate verification, and set the expected upstream certificate name to the same `ATHENA_PRIVATE_HOSTNAME` used by that Caddy stack. Do not mix certificate authorities between stacks.
- Validate the proxy configuration (for nginx, `nginx -t`) before reload, retain the previous working config, and check the login and an authenticated page afterward.
- Verify the browser-facing origin matches `BETTER_AUTH_URL`, and that `ATHENA_AUTH_PUBLIC_HTTPS_PORT` is the browser-visible port, not merely the inner proxy port.

The operator owns edge DNS, certificates, firewall, and rollback. This repository does not ship a universal nginx vhost or configure a remote proxy automatically.
