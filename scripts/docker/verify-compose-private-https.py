#!/usr/bin/env python3
"""Verify the secret-safe private HTTPS exposure of rendered Compose config."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import re
from pathlib import Path


def fail(reason: str) -> None:
    print(f"compose_https_preflight=failed reason={reason}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    project_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("environment_file", nargs="?", default=str(project_root / ".env.docker.prod"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--http-port", type=int, default=8080)
    parser.add_argument("--https-port", type=int, default=8443)
    parser.add_argument("--hostname", default="localhost")
    parser.add_argument("--proxy-source", default="172.29.100.2")
    parser.add_argument("--internal-subnet", default="172.29.100.0/24")
    parser.add_argument("--internal-ip-range", default="172.29.100.128/25")
    parser.add_argument("--public-https-port", type=int)
    parser.add_argument("--origin-https-port", type=int)
    args = parser.parse_args()

    environment_file = Path(args.environment_file).resolve()
    if not environment_file.is_file():
        fail("missing-environment-file")

    command = [
        "docker",
        "compose",
        "--env-file",
        str(environment_file),
        "-f",
        str(project_root / "docker-compose.yml"),
        "-f",
        str(project_root / "docker-compose.prod.yml"),
        "config",
        "--format",
        "json",
    ]
    try:
        rendered = subprocess.run(command, check=False, capture_output=True, text=True)
    except OSError:
        fail("docker-unavailable")
    if rendered.returncode != 0:
        fail("compose-render-failed")

    try:
        data = json.loads(rendered.stdout)
        services = data["services"]
        networks = data.get("networks", {})
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        fail("invalid-compose-output")

    # Only Caddy publishes ports; web and postgres must stay internal.
    for name, svc in services.items():
        if name != "caddy" and svc.get("ports"):
            fail("private-service-published")
    if not services.get("caddy", {}).get("ports"):
        fail("caddy-not-published")

    actual_ports = {
        (int(port["target"]), int(port["published"]), port["host_ip"])
        for port in services["caddy"]["ports"]
    }
    expected_ports = {
        (80, args.http_port, args.host),
        (443, args.https_port, args.host),
    }
    if actual_ports != expected_ports:
        fail("unexpected-caddy-ports")

    # Internal network with the expected subnet and Caddy's static address.
    athena_internal = networks.get("athena_internal", {})
    ipam_config = athena_internal.get("ipam", {}).get("config", [{}])
    if not ipam_config or ipam_config[0].get("subnet") != args.internal_subnet:
        fail("missing-internal-subnet")
    if ipam_config[0].get("ip_range") != args.internal_ip_range:
        fail("missing-internal-ip-range")
    caddy_networks = services["caddy"].get("networks", {})
    if caddy_networks.get("athena_internal", {}).get("ipv4_address") != args.proxy_source:
        fail("missing-caddy-static-ip")

    # Caddy receives the HTTPS port so the HTTP->HTTPS redirect matches the published port.
    caddy_env = services["caddy"].get("environment", {})
    if caddy_env.get("ATHENA_PRIVATE_HOSTNAME") != args.hostname:
        fail("missing-caddy-hostname")
    if caddy_env.get("ATHENA_PROD_HTTPS_PORT") != str(args.https_port):
        fail("unexpected-caddy-https-port")
    public_https_port = args.public_https_port if args.public_https_port is not None else args.https_port
    if caddy_env.get("ATHENA_AUTH_PUBLIC_HTTPS_PORT") != str(public_https_port):
        fail("unexpected-browser-https-port")
    if caddy_env.get("ATHENA_PROD_CADDY_INTERNAL_IP") != args.proxy_source:
        fail("unexpected-caddy-internal-ip")

    # Caddyfile marker contract (inspect the local Caddyfile, not the rendered config).
    caddyfile = project_root / "infrastructure" / "docker" / "Caddyfile"
    try:
        caddy_config = caddyfile.read_text()
    except OSError:
        fail("missing-caddyfile")
    if "redir https://{$ATHENA_PRIVATE_HOSTNAME}:{$ATHENA_PROD_HTTPS_PORT}{uri} permanent" not in caddy_config:
        fail("missing-caddy-redirect")
    if 'X-Athena-Proxy-Source "{$ATHENA_PROD_CADDY_INTERNAL_IP}"' not in caddy_config:
        fail("missing-caddy-proxy-marker")
    if 'X-Forwarded-For "{remote_host}, {$ATHENA_PROD_CADDY_INTERNAL_IP}"' not in caddy_config:
        fail("missing-caddy-forwarded-for")
    if "header_up -X-Real-*" not in caddy_config:
        fail("missing-caddy-real-ip-strip")
    if "header_up X-Forwarded-Port {$ATHENA_AUTH_PUBLIC_HTTPS_PORT}" not in caddy_config:
        fail("missing-caddy-forwarded-port")
    if "health_headers {" not in caddy_config:
        fail("missing-caddy-health-headers")
    if "X-Athena-Proxy-Source {$ATHENA_PROD_CADDY_INTERNAL_IP}" not in caddy_config:
        fail("missing-caddy-health-marker")
    if "X-Forwarded-Host {$ATHENA_PRIVATE_HOSTNAME}:{$ATHENA_AUTH_PUBLIC_HTTPS_PORT}" not in caddy_config:
        fail("missing-caddy-health-forwarded-host")
    if "X-Forwarded-Proto https" not in caddy_config:
        fail("missing-caddy-health-forwarded-proto")
    if "X-Forwarded-Port {$ATHENA_AUTH_PUBLIC_HTTPS_PORT}" not in caddy_config:
        fail("missing-caddy-health-forwarded-port")

    # Web auth env must match the private HTTPS origin/cookie/proxy contract.
    web_env = services.get("web", {}).get("environment", {})
    web_build_args = services.get("web", {}).get("build", {}).get("args", {})
    origin_https_port = args.origin_https_port if args.origin_https_port is not None else args.https_port
    expected_origin = f"https://{args.hostname}"
    if origin_https_port != 443:
        expected_origin += f":{origin_https_port}"
    if web_build_args.get("BETTER_AUTH_URL") != expected_origin:
        fail("missing-build-better-auth-url")
    if web_build_args.get("ATHENA_AUTH_TRUSTED_ORIGINS", "") != web_env.get("ATHENA_AUTH_TRUSTED_ORIGINS", ""):
        fail("missing-build-trusted-origins")
    if web_build_args.get("ATHENA_AUTH_TRUSTED_PROXY_IPS") != args.proxy_source:
        fail("missing-build-trusted-proxies")
    if web_env.get("BETTER_AUTH_URL") != expected_origin:
        fail("missing-better-auth-url")
    if web_env.get("ATHENA_AUTH_COOKIE_SECURE") != "true":
        fail("missing-secure-cookie")
    if web_env.get("ATHENA_AUTH_TRUSTED_PROXY_IPS") != args.proxy_source:
        fail("missing-trusted-proxies")
    if web_env.get("ATHENA_PROD_CADDY_INTERNAL_IP") != args.proxy_source:
        fail("missing-web-caddy-internal-ip")

    # Healthchecks must be marker-bearing and scope to internal/external port split.
    caddy_health = " ".join(services["caddy"].get("healthcheck", {}).get("test", []))
    if "https://" not in caddy_health or ":443" not in caddy_health:
        fail("missing-caddy-https-healthcheck")
    if "Host:" not in caddy_health or "ATHENA_PRIVATE_HOSTNAME" not in caddy_health or "ATHENA_AUTH_PUBLIC_HTTPS_PORT" not in caddy_health:
        fail("missing-caddy-healthcheck-host")

    # The Caddy healthcheck must double-quote the Host header so the shell expands the variables.
    compose_file = project_root / "docker-compose.prod.yml"
    try:
        compose_text = compose_file.read_text()
    except OSError:
        fail("missing-compose-file")
    if r'--header \"Host: $${ATHENA_PRIVATE_HOSTNAME}:$${ATHENA_AUTH_PUBLIC_HTTPS_PORT}\"' not in compose_text:
        fail("missing-caddy-healthcheck-host-quote")
    web_health = " ".join(services["web"].get("healthcheck", {}).get("test", []))
    if "X-Athena-Proxy-Source':proxySource" not in web_health:
        fail("missing-web-health-marker")
    if "X-Forwarded-For':proxySource" not in web_health:
        fail("missing-web-health-forwarded-for")
    if "X-Forwarded-Host':url.host" not in web_health or "BETTER_AUTH_URL" not in web_health:
        fail("missing-web-health-forwarded-host")
    if "X-Forwarded-Proto':url.protocol.slice(0,-1)" not in web_health:
        fail("missing-web-health-forwarded-proto")
    if "X-Forwarded-Port':url.port" not in web_health:
        fail("missing-web-health-forwarded-port")

    # External refs must include a tag@digest. Only locally-built operator
    # image services may use an immutable local image ID; mutable local tags
    # are not provenance.
    external_image_re = re.compile(
        r"^(?:[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*):[^@]+@sha256:[a-f0-9]{64}$"
    )
    local_image_id_re = re.compile(r"^sha256:[a-f0-9]{64}$")

    def validate_image_ref(ref: str, purpose: str, *, allow_local_image_id: bool = False) -> None:
        if not isinstance(ref, str) or not ref:
            fail(f"{purpose}-missing")
        if external_image_re.match(ref):
            return
        if allow_local_image_id and local_image_id_re.match(ref):
            return
        fail(f"{purpose}-not-pinned")

    for name, svc in services.items():
        image = svc.get("image")
        if image is not None:
            validate_image_ref(
                image,
                f"service-{name}-image",
                allow_local_image_id=name in {"db-tools", "scheduled-backup"},
            )
        build = svc.get("build")
        if isinstance(build, dict):
            for arg in ("NODE_IMAGE", "POSTGRES_IMAGE"):
                value = build.get("args", {}).get(arg)
                if value:
                    validate_image_ref(value, f"service-{name}-{arg}")
    print("compose_https_preflight=passed")


if __name__ == "__main__":
    main()
