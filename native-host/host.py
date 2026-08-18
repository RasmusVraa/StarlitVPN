#!/usr/bin/env python3
"""StarlitVPN native messaging host. Starts/stops a detached Xray-core process."""
from __future__ import annotations

import json
import os
import platform
import shutil
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

HOST_NAME = "com.starlitvpn.host"
APP_DIR = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("HOME") or ".") / "StarlitVPN"
CORE_DIR = APP_DIR / "core"
CFG_PATH = APP_DIR / "config.json"
PID_PATH = APP_DIR / "xray.pid"
LOG_PATH = APP_DIR / "xray.log"
UA = "StarlitVPN/1.0"


def bin_name() -> str:
    return "xray.exe" if os.name == "nt" else "xray"


def xray_bin() -> Path:
    return CORE_DIR / bin_name()


def asset_name() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    arm = "arm" in machine or machine == "aarch64"
    if system == "windows":
        return "Xray-windows-arm64-v8a.zip" if arm else "Xray-windows-64.zip"
    if system == "darwin":
        return "Xray-macos-arm64-v8a.zip" if arm else "Xray-macos-64.zip"
    if arm:
        return "Xray-linux-arm64-v8a.zip"
    return "Xray-linux-64.zip"


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len or len(raw_len) < 4:
        return None
    length = struct.unpack("<I", raw_len)[0]
    data = sys.stdin.buffer.read(length)
    if len(data) < length:
        return None
    return json.loads(data.decode("utf-8"))


def send_message(msg: dict) -> None:
    encoded = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        if os.name == "nt":
            import ctypes
            SYNCHRONIZE = 0x00100000
            handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, pid)
            if handle:
                ctypes.windll.kernel32.CloseHandle(handle)
                return True
            return False
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def current_pid() -> int | None:
    if not PID_PATH.exists():
        return None
    try:
        pid = int(PID_PATH.read_text(encoding="utf-8").strip())
    except ValueError:
        return None
    if pid_alive(pid):
        return pid
    PID_PATH.unlink(missing_ok=True)
    return None


def core_version() -> str | None:
    exe = xray_bin()
    if not exe.exists():
        return None
    try:
        out = subprocess.check_output([str(exe), "version"], cwd=str(CORE_DIR), stderr=subprocess.STDOUT, timeout=8)
        line = out.decode("utf-8", "ignore").splitlines()[0].strip()
        return line
    except Exception:
        return "installed"


def ensure_core() -> dict:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    CORE_DIR.mkdir(parents=True, exist_ok=True)
    if xray_bin().exists():
        return {"ok": True, "core": {"version": core_version(), "path": str(xray_bin())}}
    asset = asset_name()
    url = f"https://github.com/XTLS/Xray-core/releases/latest/download/{asset}"
    zip_path = CORE_DIR / asset
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as resp, open(zip_path, "wb") as fh:
        shutil.copyfileobj(resp, fh)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(CORE_DIR)
    zip_path.unlink(missing_ok=True)
    exe = xray_bin()
    if not exe.exists():
        return {"ok": False, "error": f"В архиве нет {exe.name}"}
    if os.name != "nt":
        exe.chmod(exe.stat().st_mode | 0o111)
    return {"ok": True, "core": {"version": core_version(), "path": str(exe)}}


def stop_xray() -> dict:
    pid = current_pid()
    if pid:
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(pid), "/F", "/T"], capture_output=True, check=False)
            else:
                os.kill(pid, 15)
                time.sleep(0.3)
                if pid_alive(pid):
                    os.kill(pid, 9)
        except OSError:
            pass
    PID_PATH.unlink(missing_ok=True)
    return {"ok": True, "running": False}


def start_xray(config: dict, port: int | None = None) -> dict:
    ready = ensure_core()
    if not ready.get("ok"):
        return ready
    APP_DIR.mkdir(parents=True, exist_ok=True)
    if port:
        for inbound in config.get("inbounds") or []:
            if inbound.get("tag") == "socks-in":
                inbound["port"] = int(port)
            if inbound.get("tag") == "http-in":
                inbound["port"] = int(port) + 1
    CFG_PATH.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    stop_xray()
    logf = open(LOG_PATH, "ab", buffering=0)
    kwargs: dict = {
        "cwd": str(CORE_DIR),
        "stdout": logf,
        "stderr": logf,
        "stdin": subprocess.DEVNULL,
    }
    if os.name == "nt":
        kwargs["creationflags"] = (
            subprocess.CREATE_NEW_PROCESS_GROUP
            | 0x01000000  # CREATE_BREAKAWAY_FROM_JOB
            | 0x08000000  # CREATE_NO_WINDOW
        )
        kwargs["close_fds"] = False
    else:
        kwargs["start_new_session"] = True
        kwargs["close_fds"] = True
    proc = subprocess.Popen([str(xray_bin()), "run", "-c", str(CFG_PATH)], **kwargs)
    PID_PATH.write_text(str(proc.pid), encoding="utf-8")
    time.sleep(0.5)
    if not pid_alive(proc.pid):
        tail = LOG_PATH.read_text(encoding="utf-8", errors="ignore")[-2000:] if LOG_PATH.exists() else ""
        return {"ok": False, "error": "Xray сразу завершился", "log": tail}
    return {
        "ok": True,
        "running": True,
        "pid": proc.pid,
        "port": port,
        "core": {"version": core_version(), "path": str(xray_bin())},
    }


HAPP_UA = "Happ/3.3.6/windows StarlitVPN/1.0.10"


def fetch_url(url: str, user_agent: str | None = None) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent or HAPP_UA,
            "Accept": "*/*",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            body = resp.read(4_000_000 + 1)
            truncated = len(body) > 4_000_000
            text = body[:4_000_000].decode("utf-8", "replace")
            return {
                "ok": True,
                "status": int(getattr(resp, "status", 200)),
                "contentType": resp.headers.get("content-type"),
                "headers": {
                    k.lower(): v
                    for k, v in resp.headers.items()
                    if k.lower() in {
                        "subscription-userinfo",
                        "profile-title",
                        "profile-update-interval",
                        "profile-web-page-url",
                    }
                },
                "body": text,
                "truncated": truncated,
            }
    except urllib.error.HTTPError as err:
        raw = err.read() if err.fp else b""
        return {
            "ok": False,
            "status": err.code,
            "error": f"HTTP {err.code}",
            "body": raw[:4000].decode("utf-8", "replace"),
        }
    except Exception as err:
        return {"ok": False, "error": str(err)}


def tcp_ping(host: str, port: int, timeout: float = 3.0) -> dict:
    started = time.perf_counter()
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            ms = int((time.perf_counter() - started) * 1000)
            return {"ok": True, "ms": ms}
    except OSError as err:
        return {"ok": False, "error": str(err)}


def status() -> dict:
    pid = current_pid()
    return {
        "ok": True,
        "running": bool(pid),
        "pid": pid,
        "core": {"version": core_version(), "path": str(xray_bin()) if xray_bin().exists() else None},
        "missing": False,
    }


def handle(msg: dict) -> dict:
    cmd = (msg or {}).get("cmd")
    try:
        if cmd == "status":
            return status()
        if cmd == "ensure_core":
            return ensure_core()
        if cmd == "start":
            return start_xray(msg.get("config") or {}, msg.get("port"))
        if cmd == "stop":
            return stop_xray()
        if cmd == "ping":
            return tcp_ping(msg.get("host") or "", int(msg.get("port") or 0))
        if cmd == "fetch":
            return fetch_url(msg.get("url") or "", msg.get("userAgent"))
        return {"ok": False, "error": f"unknown cmd: {cmd}"}
    except Exception as err:
        return {"ok": False, "error": str(err)}


def native_loop() -> None:
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    while True:
        msg = read_message()
        if msg is None:
            break
        send_message(handle(msg))


if __name__ == "__main__":
    if "--ensure-core" in sys.argv:
        print(json.dumps(ensure_core(), ensure_ascii=False, indent=2))
        sys.exit(0)
    if "--status" in sys.argv:
        print(json.dumps(status(), ensure_ascii=False, indent=2))
        sys.exit(0)
    native_loop()
