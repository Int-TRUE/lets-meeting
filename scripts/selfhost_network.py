"""HTTP settings for the server's actual Tailscale IPv4, without Serve or MagicDNS."""
import ipaddress
import subprocess


def http_settings():
    value = subprocess.check_output(['tailscale', 'ip', '-4'], text=True).strip()
    address = ipaddress.IPv4Address(value)
    if address not in ipaddress.IPv4Network('100.64.0.0/10'):
        raise ValueError('Expected a Tailscale IPv4 address; no configuration changed.')
    origin = f'http://{address}:8088'
    return {
        'PUBLIC_ORIGIN': origin,
        'ROBOT_BUTLER_HTTP_ORIGIN': origin,
        'ROBOT_BUTLER_BIND_IP': str(address),
    }


def replace_settings(text, settings):
    lines = [line for line in text.splitlines()
             if line.split('=', 1)[0].strip() not in settings]
    return '\n'.join(lines + [f'{key}={value}' for key, value in settings.items()]) + '\n'
