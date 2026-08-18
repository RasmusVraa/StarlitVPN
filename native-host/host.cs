using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

internal static class Program
{
    const string HostName = "com.starlitvpn.host";
    const string ChromeId = "fgefnlplpplkhobagcpieacdkghcpbdg";
    const string FirefoxId = "starlitvpn@starlit-moon.ru";
    const uint CREATE_NO_WINDOW = 0x08000000;
    const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
    const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;

    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 20000000 };
    static readonly string AppDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StarlitVPN");
    static readonly string CoreDir = Path.Combine(AppDir, "core");
    static readonly string CfgPath = Path.Combine(AppDir, "config.json");
    static readonly string PidPath = Path.Combine(AppDir, "xray.pid");
    static readonly string LogPath = Path.Combine(AppDir, "xray.log");
    static readonly Mutex XrayGate = new Mutex(false, "Local\\StarlitVPN-xray-gate");

    [STAThread]
    static int Main(string[] args)
    {
        Directory.CreateDirectory(AppDir);
        HideConsole();
        Log("start args=" + string.Join(" ", args ?? new string[0]));
        try
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            if (!IsNativeHostLaunch(args))
            {
                Log("register");
                var result = Register();
                var ok = result.ContainsKey("ok") && (bool)result["ok"];
                Log("register done ok=" + ok);
                var msg = ok
                    ? "StarlitVPN установлен.\n\nВернитесь в браузер и снова откройте расширение."
                    : ("Не удалось установить: " + Str(result, "error"));
                Notify(msg);
                return ok ? 0 : 1;
            }
            Log("native loop");
            NativeLoop();
            return 0;
        }
        catch (Exception ex)
        {
            Log(ex.ToString());
            Notify("Ошибка установщика StarlitVPN:\n\n" + ex.Message);
            return 1;
        }
    }

    static bool IsNativeHostLaunch(string[] args)
    {
        if (args == null || args.Length == 0) return false;
        foreach (var raw in args)
        {
            if (string.IsNullOrEmpty(raw)) continue;
            if (raw == "--register" || raw == "--ensure-core" || raw == "--install") return false;
            var a = raw.Trim().Trim('"');
            if (a.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase)) return true;
            if (a.StartsWith("moz-extension://", StringComparison.OrdinalIgnoreCase)) return true;
            if (File.Exists(a) && a.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    var text = File.ReadAllText(a);
                    if (text.IndexOf(HostName, StringComparison.OrdinalIgnoreCase) >= 0) return true;
                }
                catch { }
            }
        }
        return false;
    }

    static void Log(string text)
    {
        try { File.AppendAllText(Path.Combine(AppDir, "host.log"), DateTime.Now.ToString("s") + " " + text + Environment.NewLine); } catch { }
    }

    static void NativeLoop()
    {
        HideConsole();
        Log("native loop pid=" + Process.GetCurrentProcess().Id);
        var stdin = Console.OpenStandardInput();
        var stdout = Console.OpenStandardOutput();
        while (true)
        {
            var raw = ReadMessage(stdin);
            if (raw == null) break;
            var reply = Handle(raw);
            WriteMessage(stdout, reply);
        }
        Log("native loop exit pid=" + Process.GetCurrentProcess().Id);
    }

    static string ReadMessage(Stream stdin)
    {
        var lenBuf = new byte[4];
        if (!ReadFull(stdin, lenBuf, 4)) return null;
        var len = BitConverter.ToInt32(lenBuf, 0);
        if (len <= 0 || len > 20000000) return null;
        var buf = new byte[len];
        if (!ReadFull(stdin, buf, len)) return null;
        return Encoding.UTF8.GetString(buf);
    }

    static void WriteMessage(Stream stdout, Dictionary<string, object> msg)
    {
        var bytes = Encoding.UTF8.GetBytes(Json.Serialize(msg));
        stdout.Write(BitConverter.GetBytes(bytes.Length), 0, 4);
        stdout.Write(bytes, 0, bytes.Length);
        stdout.Flush();
    }

    static bool ReadFull(Stream s, byte[] buf, int n)
    {
        var got = 0;
        while (got < n)
        {
            var r = s.Read(buf, got, n - got);
            if (r <= 0) return false;
            got += r;
        }
        return true;
    }

    static Dictionary<string, object> Handle(string raw)
    {
        try
        {
            var msg = Json.Deserialize<Dictionary<string, object>>(raw) ?? new Dictionary<string, object>();
            var cmd = Str(msg, "cmd");
            if (cmd == "status") return Status();
            if (cmd == "ensure_core") return EnsureCore();
            if (cmd == "start") return WithXrayGate(() => StartXray(Str(msg, "configText"), msg.ContainsKey("config") ? msg["config"] : null, IntVal(msg, "port"), Flag(msg, "force")));
            if (cmd == "stop") return WithXrayGate(() => StopXray());
            if (cmd == "ping") return TcpPing(Str(msg, "host"), IntVal(msg, "port"));
            if (cmd == "fetch") return FetchUrl(msg);
            if (cmd == "register") return Register();
            if (cmd == "self_update") return SelfUpdate(Str(msg, "url"));
            return Fail("unknown cmd: " + cmd);
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    static Dictionary<string, object> Register()
    {
        Directory.CreateDirectory(AppDir);
        var dest = Path.Combine(AppDir, "host.exe");
        var src = Assembly.GetExecutingAssembly().Location;
        Log("copy " + src + " -> " + dest);
        if (!string.IsNullOrEmpty(src) && File.Exists(src) && !PathsEqual(src, dest))
        {
            try { File.Copy(src, dest, true); }
            catch (Exception ex)
            {
                Log("copy failed " + ex.Message);
                dest = src;
            }
        }
        WriteManifests(dest);
        RememberExtFromSelf();
        var st = Status();
        st["registered"] = true;
        st["path"] = dest;
        return st;
    }

    static void Notify(string text)
    {
        try { MessageBox(IntPtr.Zero, text, "StarlitVPN", 0x00000040u | 0x00040000u); }
        catch { }
    }

    static void WriteManifests(string hostPath)
    {
        var escaped = hostPath.Replace("\\", "\\\\");
        var chromeJson = "{\n  \"name\": \"" + HostName + "\",\n  \"description\": \"StarlitVPN Xray native host\",\n  \"path\": \"" + escaped + "\",\n  \"type\": \"stdio\",\n  \"allowed_origins\": [\"chrome-extension://" + ChromeId + "/\"]\n}\n";
        var firefoxJson = "{\n  \"name\": \"" + HostName + "\",\n  \"description\": \"StarlitVPN Xray native host\",\n  \"path\": \"" + escaped + "\",\n  \"type\": \"stdio\",\n  \"allowed_extensions\": [\"" + FirefoxId + "\"]\n}\n";

        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var chromeDirs = new[]
        {
            Path.Combine(local, @"Google\Chrome\User Data\NativeMessagingHosts"),
            Path.Combine(local, @"Microsoft\Edge\User Data\NativeMessagingHosts"),
            Path.Combine(local, @"BraveSoftware\Brave-Browser\User Data\NativeMessagingHosts"),
            Path.Combine(local, @"Chromium\User Data\NativeMessagingHosts"),
            Path.Combine(local, @"Yandex\YandexBrowser\User Data\NativeMessagingHosts")
        };
        foreach (var dir in chromeDirs)
        {
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, HostName + ".json"), chromeJson, new UTF8Encoding(false));
        }
        var ffDir = Path.Combine(roaming, @"Mozilla\Firefox\NativeMessagingHosts");
        Directory.CreateDirectory(ffDir);
        File.WriteAllText(Path.Combine(ffDir, HostName + ".json"), firefoxJson, new UTF8Encoding(false));

        var chromeManifest = Path.Combine(local, @"Google\Chrome\User Data\NativeMessagingHosts", HostName + ".json");
        foreach (var key in new[]
        {
            @"Software\Google\Chrome\NativeMessagingHosts\" + HostName,
            @"Software\Microsoft\Edge\NativeMessagingHosts\" + HostName,
            @"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\" + HostName,
            @"Software\Chromium\NativeMessagingHosts\" + HostName,
            @"Software\Yandex\YandexBrowser\NativeMessagingHosts\" + HostName
        })
        {
            using (var k = Registry.CurrentUser.CreateSubKey(key))
                if (k != null) k.SetValue(null, chromeManifest);
        }
        var ffJson = Path.Combine(ffDir, HostName + ".json");
        using (var k = Registry.CurrentUser.CreateSubKey(@"Software\Mozilla\NativeMessagingHosts\" + HostName))
            if (k != null) k.SetValue(null, ffJson);
    }

    static string XrayBin()
    {
        return Path.Combine(CoreDir, "xray.exe");
    }

    static Dictionary<string, object> EnsureCore()
    {
        Directory.CreateDirectory(CoreDir);
        if (File.Exists(XrayBin())) return OkCore();
        var arm = (Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "").IndexOf("ARM", StringComparison.OrdinalIgnoreCase) >= 0;
        var asset = arm ? "Xray-windows-arm64-v8a.zip" : "Xray-windows-64.zip";
        var url = "https://github.com/XTLS/Xray-core/releases/latest/download/" + asset;
        var zipPath = Path.Combine(CoreDir, asset);
        try
        {
            using (var wc = new WebClient())
            {
                wc.Headers[HttpRequestHeader.UserAgent] = "StarlitVPN/1.0";
                wc.DownloadFile(url, zipPath);
            }
            ZipFile.ExtractToDirectory(zipPath, CoreDir);
            try { File.Delete(zipPath); } catch { }
        }
        catch (Exception ex)
        {
            return Fail("Не удалось скачать Xray: " + ex.Message);
        }
        if (!File.Exists(XrayBin())) return Fail("В архиве нет xray.exe");
        return OkCore();
    }

    static bool Flag(Dictionary<string, object> msg, string key)
    {
        if (msg == null || !msg.ContainsKey(key) || msg[key] == null) return false;
        var v = msg[key];
        if (v is bool) return (bool)v;
        var s = Convert.ToString(v);
        return string.Equals(s, "true", StringComparison.OrdinalIgnoreCase) || s == "1";
    }

    static Dictionary<string, object> WithXrayGate(Func<Dictionary<string, object>> fn)
    {
        var owned = false;
        try
        {
            try { owned = XrayGate.WaitOne(20000); }
            catch (AbandonedMutexException) { owned = true; }
            if (!owned) return Fail("Xray занят, повторите");
            return fn();
        }
        finally
        {
            if (owned)
            {
                try { XrayGate.ReleaseMutex(); } catch { }
            }
        }
    }

    static Dictionary<string, object> StartXray(string configText, object configObj, int port, bool force)
    {
        var ready = EnsureCore();
        if (!(bool)ready["ok"]) return ready;
        if (string.IsNullOrEmpty(configText) && configObj != null)
            configText = Json.Serialize(configObj);
        if (string.IsNullOrEmpty(configText)) return Fail("empty config");
        if (port > 0)
        {
            try
            {
                var cfg = Json.Deserialize<Dictionary<string, object>>(configText);
                if (cfg != null && cfg.ContainsKey("inbounds"))
                {
                    var list = cfg["inbounds"] as System.Collections.ArrayList;
                    if (list != null)
                    {
                        foreach (Dictionary<string, object> inbound in list)
                        {
                            var tag = Str(inbound, "tag");
                            if (tag == "socks-in") inbound["port"] = port;
                            if (tag == "http-in") inbound["port"] = port + 1;
                        }
                        configText = Json.Serialize(cfg);
                    }
                }
            }
            catch { }
        }
        File.WriteAllText(CfgPath, configText, new UTF8Encoding(false));
        PatchLogPath();
        if (!force)
        {
            var live = LiveXrayPid();
            if (live.HasValue)
            {
                Log("start reuse pid=" + live.Value);
                try { File.WriteAllText(PidPath, live.Value.ToString(), Encoding.UTF8); } catch { }
                return ReuseResult(live.Value, port);
            }
            if (PortOpen(port > 0 ? port : 10808))
            {
                Log("start reuse port " + port);
                return ReuseResult(0, port);
            }
        }
        StopXray();
        WaitPortFree(port > 0 ? port : 10808, 2000);
        var cmd = "\"" + XrayBin() + "\" run -c \"" + CfgPath + "\"";
        int pid;
        if (!StartDetached(XrayBin(), cmd, CoreDir, out pid))
            return Fail("Не удалось запустить Xray");
        File.WriteAllText(PidPath, pid.ToString(), Encoding.UTF8);
        for (var i = 0; i < 40; i++)
        {
            System.Threading.Thread.Sleep(50);
            if (!PidAlive(pid)) break;
            if (PortOpen(port > 0 ? port : 10808)) break;
        }
        if (PidAlive(pid))
        {
            Log("start pid=" + pid);
            var st = OkCore();
            st["running"] = true;
            st["pid"] = pid;
            st["port"] = port;
            return st;
        }
        var leftover = LiveXrayPid();
        if (leftover.HasValue || PortOpen(port > 0 ? port : 10808))
        {
            Log("start recovered pid=" + leftover);
            return ReuseResult(leftover.HasValue ? leftover.Value : 0, port);
        }
        Log("start died pid=" + pid);
        return Fail("Xray сразу завершился" + TailLog());
    }

    static void PatchLogPath()
    {
        try
        {
            var text = File.ReadAllText(CfgPath);
            var escaped = LogPath.Replace("\\", "\\\\");
            if (text.IndexOf("\"error\"", StringComparison.Ordinal) >= 0 && text.IndexOf(escaped, StringComparison.Ordinal) >= 0)
                return;
            if (!Regex.IsMatch(text, "\"log\"\\s*:\\s*\\{")) return;
            text = new Regex("(\"log\"\\s*:\\s*\\{)").Replace(text, "$1\"error\":\"" + escaped + "\",", 1);
            File.WriteAllText(CfgPath, text, new UTF8Encoding(false));
        }
        catch { }
    }

    static string TailLog()
    {
        try
        {
            if (!File.Exists(LogPath)) return "";
            var text = File.ReadAllText(LogPath);
            if (string.IsNullOrEmpty(text)) return "";
            var lines = text.Replace("\r\n", "\n").Split('\n');
            var start = Math.Max(0, lines.Length - 8);
            var chunk = string.Join(" ", lines, start, lines.Length - start).Trim();
            if (chunk.Length > 280) chunk = chunk.Substring(chunk.Length - 280);
            return chunk.Length > 0 ? ": " + chunk : "";
        }
        catch { return ""; }
    }

    static Dictionary<string, object> ReuseResult(int pid, int port)
    {
        var reused = OkCore();
        reused["running"] = true;
        reused["pid"] = pid;
        reused["reused"] = true;
        reused["port"] = port;
        return reused;
    }

    static int? LiveXrayPid()
    {
        var fromFile = CurrentPid();
        if (fromFile.HasValue) return fromFile;
        try
        {
            foreach (var p in Process.GetProcessesByName("xray"))
            {
                try
                {
                    if (p.HasExited) continue;
                    try
                    {
                        var path = p.MainModule != null ? p.MainModule.FileName : "";
                        if (!string.IsNullOrEmpty(path) && !PathsEqual(path, XrayBin())) continue;
                    }
                    catch { }
                    try { File.WriteAllText(PidPath, p.Id.ToString(), Encoding.UTF8); } catch { }
                    return p.Id;
                }
                catch { }
            }
        }
        catch { }
        return null;
    }

    static bool PortOpen(int port)
    {
        if (port <= 0) return false;
        try
        {
            using (var sock = new TcpClient())
            {
                var ar = sock.BeginConnect("127.0.0.1", port, null, null);
                return ar.AsyncWaitHandle.WaitOne(200, false) && sock.Connected;
            }
        }
        catch { return false; }
    }

    static void WaitPortFree(int port, int ms)
    {
        var until = Environment.TickCount + ms;
        while (Environment.TickCount < until)
        {
            if (!PortOpen(port)) return;
            System.Threading.Thread.Sleep(50);
        }
    }

    static void KillPid(int pid)
    {
        if (pid <= 0) return;
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "taskkill",
                Arguments = "/PID " + pid + " /F /T",
                CreateNoWindow = true,
                UseShellExecute = false
            }).WaitForExit(3000);
        }
        catch { }
    }

    static Dictionary<string, object> StopXray()
    {
        var pids = new Dictionary<int, bool>();
        var cur = CurrentPid();
        if (cur.HasValue) pids[cur.Value] = true;
        var live = LiveXrayPid();
        if (live.HasValue) pids[live.Value] = true;
        foreach (var pid in pids.Keys) KillPid(pid);
        try { if (File.Exists(PidPath)) File.Delete(PidPath); } catch { }
        return new Dictionary<string, object> { { "ok", true }, { "running", false } };
    }

    static Dictionary<string, object> TcpPing(string host, int port)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            using (var sock = new TcpClient())
            {
                var ar = sock.BeginConnect(host, port, null, null);
                if (!ar.AsyncWaitHandle.WaitOne(3000, false) || !sock.Connected)
                    return Fail("timeout");
                sock.EndConnect(ar);
            }
            return new Dictionary<string, object> { { "ok", true }, { "ms", (int)sw.ElapsedMilliseconds } };
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    static Dictionary<string, object> FetchUrl(Dictionary<string, object> msg)
    {
        var url = Str(msg, "url");
        var userAgent = Str(msg, "userAgent");
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.UserAgent = string.IsNullOrEmpty(userAgent) ? "Happ/3.3.6/windows StarlitVPN/1.0.10" : userAgent;
            req.Accept = "*/*";
            req.Timeout = 45000;
            var hwid = DeviceHwid(HeaderFromMsg(msg, "x-hwid"));
            TrySetHeader(req, "x-hwid", hwid);
            TrySetHeader(req, "x-device-os", FirstNonEmpty(HeaderFromMsg(msg, "x-device-os"), "Windows"));
            TrySetHeader(req, "x-ver-os", FirstNonEmpty(HeaderFromMsg(msg, "x-ver-os"), Environment.OSVersion.Version.ToString()));
            TrySetHeader(req, "x-device-model", FirstNonEmpty(HeaderFromMsg(msg, "x-device-model"), "StarlitVPN"));
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var stream = resp.GetResponseStream())
            using (var ms = new MemoryStream())
            {
                stream.CopyTo(ms);
                var bytes = ms.ToArray();
                var truncated = bytes.Length > 4000000;
                var text = Encoding.UTF8.GetString(bytes, 0, Math.Min(bytes.Length, 4000000));
                return new Dictionary<string, object>
                {
                    { "ok", true },
                    { "status", (int)resp.StatusCode },
                    { "contentType", resp.ContentType },
                    { "headers", CollectSubHeaders(resp) },
                    { "body", text },
                    { "truncated", truncated },
                    { "hwid", hwid }
                };
            }
        }
        catch (WebException ex)
        {
            var http = ex.Response as HttpWebResponse;
            var body = "";
            Dictionary<string, object> headers = null;
            if (http != null)
            {
                try { using (var sr = new StreamReader(http.GetResponseStream(), Encoding.UTF8)) body = sr.ReadToEnd(); } catch { }
                headers = CollectSubHeaders(http);
                return new Dictionary<string, object> { { "ok", false }, { "status", (int)http.StatusCode }, { "error", "HTTP " + (int)http.StatusCode }, { "body", body.Length > 4000 ? body.Substring(0, 4000) : body }, { "headers", headers } };
            }
            return Fail(ex.Message);
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    static void TrySetHeader(HttpWebRequest req, string name, string value)
    {
        if (req == null || string.IsNullOrEmpty(name) || string.IsNullOrEmpty(value)) return;
        try { req.Headers.Remove(name); } catch { }
        try { req.Headers.Add(name, value); } catch { try { req.Headers[name] = value; } catch { } }
    }

    static Dictionary<string, object> CollectSubHeaders(HttpWebResponse resp)
    {
        var headers = new Dictionary<string, object>();
        foreach (var key in new[] {
            "subscription-userinfo", "profile-title", "profile-update-interval", "profile-web-page-url",
            "x-hwid-active", "x-hwid-not-supported", "x-hwid-max-devices-reached", "x-hwid-limit"
        })
        {
            var v = resp.Headers[key];
            if (!string.IsNullOrEmpty(v)) headers[key] = v;
        }
        return headers;
    }

    static string HeaderFromMsg(Dictionary<string, object> msg, string key)
    {
        if (msg == null) return "";
        object boxed;
        if (msg.TryGetValue(key, out boxed) && boxed != null && Convert.ToString(boxed).Length > 0)
            return Convert.ToString(boxed);
        if (!msg.ContainsKey("headers") || msg["headers"] == null) return "";
        var dictObj = msg["headers"] as Dictionary<string, object>;
        if (dictObj != null)
        {
            object v;
            if (dictObj.TryGetValue(key, out v) && v != null) return Convert.ToString(v);
            return "";
        }
        var dictStr = msg["headers"] as Dictionary<string, string>;
        if (dictStr != null)
        {
            string v;
            if (dictStr.TryGetValue(key, out v)) return v ?? "";
        }
        return "";
    }

    static string FirstNonEmpty(string a, string b)
    {
        return string.IsNullOrEmpty(a) ? b : a;
    }

    static string DeviceHwid(string fromClient)
    {
        var file = Path.Combine(AppDir, "hwid.txt");
        if (!string.IsNullOrEmpty(fromClient) && Regex.IsMatch(fromClient, "^[a-zA-Z0-9=-]{10,64}$"))
        {
            try { File.WriteAllText(file, fromClient, new UTF8Encoding(false)); } catch { }
            return fromClient;
        }
        try
        {
            if (File.Exists(file))
            {
                var saved = (File.ReadAllText(file) ?? "").Trim();
                if (Regex.IsMatch(saved, "^[a-zA-Z0-9=-]{10,64}$")) return saved;
            }
        }
        catch { }
        var raw = Convert.ToBase64String(Guid.NewGuid().ToByteArray()).Replace("+", "-").Replace("/", "x").TrimEnd('=');
        if (raw.Length < 16) raw = (raw + "StarlitVPN12").Substring(0, 16);
        if (raw.Length > 64) raw = raw.Substring(0, 64);
        try { File.WriteAllText(file, raw, new UTF8Encoding(false)); } catch { }
        return raw;
    }

    static Dictionary<string, object> Status()
    {
        var pid = LiveXrayPid();
        return new Dictionary<string, object>
        {
            { "ok", true },
            { "running", pid.HasValue },
            { "pid", pid.HasValue ? (object)pid.Value : null },
            { "core", CoreInfo() },
            { "missing", false },
            { "hostVersion", "1.0.18" },
            { "hwidCapable", true }
        };
    }

    static Dictionary<string, object> OkCore()
    {
        return new Dictionary<string, object> { { "ok", true }, { "core", CoreInfo() } };
    }

    static Dictionary<string, object> CoreInfo()
    {
        return new Dictionary<string, object>
        {
            { "version", CoreVersion() },
            { "path", File.Exists(XrayBin()) ? XrayBin() : null }
        };
    }

    static string CoreVersion()
    {
        if (!File.Exists(XrayBin())) return null;
        try
        {
            var p = Process.Start(new ProcessStartInfo
            {
                FileName = XrayBin(),
                Arguments = "version",
                WorkingDirectory = CoreDir,
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            });
            var output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(8000);
            var line = (output ?? "").Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            return line.Length > 0 ? line[0].Trim() : "installed";
        }
        catch { return "installed"; }
    }

    static int? CurrentPid()
    {
        if (!File.Exists(PidPath)) return null;
        int pid;
        try { pid = int.Parse(File.ReadAllText(PidPath).Trim()); }
        catch { return null; }
        if (PidAlive(pid)) return pid;
        try { File.Delete(PidPath); } catch { }
        return null;
    }

    static bool PidAlive(int pid)
    {
        if (pid <= 0) return false;
        try
        {
            var p = Process.GetProcessById(pid);
            return p != null && !p.HasExited;
        }
        catch { return false; }
    }

    static bool StartDetached(string fileName, string commandLine, string cwd, out int pid)
    {
        pid = 0;
        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        PROCESS_INFORMATION pi;
        var flags = CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_PROCESS_GROUP;
        var app = (!string.IsNullOrEmpty(fileName) && fileName.IndexOfAny(new[] { '\\', '/' }) >= 0) ? fileName : null;
        if (!CreateProcess(app, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, cwd, ref si, out pi))
            return false;
        pid = pi.dwProcessId;
        if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
        if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
        return pid > 0;
    }

    static Dictionary<string, object> Fail(string error)
    {
        return new Dictionary<string, object> { { "ok", false }, { "error", error ?? "error" } };
    }

    static string PathsFile()
    {
        return Path.Combine(AppDir, "extension.paths");
    }

    static void RememberExtFromSelf()
    {
        try
        {
            var src = Assembly.GetExecutingAssembly().Location;
            if (string.IsNullOrEmpty(src)) return;
            var nativeDir = Path.GetDirectoryName(src);
            if (string.IsNullOrEmpty(nativeDir) || !string.Equals(Path.GetFileName(nativeDir), "native", StringComparison.OrdinalIgnoreCase)) return;
            var extDir = Path.GetDirectoryName(nativeDir);
            if (!string.IsNullOrEmpty(extDir) && File.Exists(Path.Combine(extDir, "manifest.json")))
                SaveExtPath(extDir);
        }
        catch { }
    }

    static void SaveExtPath(string dir)
    {
        if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return;
        var full = Path.GetFullPath(dir);
        var list = LoadSavedPaths();
        foreach (var p in list)
            if (PathsEqual(p, full)) return;
        list.Add(full);
        File.WriteAllLines(PathsFile(), list.ToArray(), new UTF8Encoding(false));
    }

    static List<string> LoadSavedPaths()
    {
        var list = new List<string>();
        var file = PathsFile();
        if (!File.Exists(file)) return list;
        foreach (var line in File.ReadAllLines(file))
        {
            var p = (line ?? "").Trim();
            if (p.Length > 0) list.Add(p);
        }
        return list;
    }

    static bool AllowedUpdateUrl(string url)
    {
        Uri u;
        if (!Uri.TryCreate(url, UriKind.Absolute, out u)) return false;
        if (u.Scheme != Uri.UriSchemeHttps) return false;
        var host = (u.Host ?? "").ToLowerInvariant();
        if (host == "github.com" || host.EndsWith(".github.com"))
            return u.AbsolutePath.IndexOf("/RasmusVraa/StarlitVPN/", StringComparison.OrdinalIgnoreCase) >= 0;
        return host == "objects.githubusercontent.com"
            || host == "release-assets.githubusercontent.com"
            || host.EndsWith(".githubusercontent.com");
    }

    static Dictionary<string, object> SelfUpdate(string url)
    {
        if (!AllowedUpdateUrl(url)) return Fail("Некорректная ссылка обновления");
        Directory.CreateDirectory(AppDir);
        var tmp = Path.Combine(AppDir, "update");
        try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch { }
        Directory.CreateDirectory(tmp);
        var zipPath = Path.Combine(tmp, "StarlitVPN.zip");
        try
        {
            using (var wc = new WebClient())
            {
                wc.Headers[HttpRequestHeader.UserAgent] = "StarlitVPN/1.0";
                wc.DownloadFile(url, zipPath);
            }
        }
        catch (Exception ex)
        {
            return Fail("Не удалось скачать обновление: " + ex.Message);
        }
        var extract = Path.Combine(tmp, "unpack");
        Directory.CreateDirectory(extract);
        try { ZipFile.ExtractToDirectory(zipPath, extract); }
        catch (Exception ex) { return Fail("Не удалось распаковать: " + ex.Message); }
        var root = FindManifestRoot(extract);
        if (root == null) return Fail("В архиве нет manifest.json");

        var targets = CollectUpdateTargets();
        var canonical = Path.Combine(AppDir, "app");
        try
        {
            Directory.CreateDirectory(canonical);
            CopyTree(root, canonical);
        }
        catch (Exception ex) { Log("mirror failed " + ex.Message); }

        var updated = new ArrayList();
        foreach (var target in targets)
        {
            try
            {
                Directory.CreateDirectory(target);
                CopyTree(root, target);
                SaveExtPath(target);
                updated.Add(target);
                Log("updated " + target);
            }
            catch (Exception ex)
            {
                Log("update copy failed " + target + " " + ex.Message);
            }
        }
        if (updated.Count == 0)
            return Fail("Не найден каталог загруженного расширения. Откройте chrome://extensions и загрузите папку ещё раз.");

        var newHost = Path.Combine(root, "native", "host.exe");
        if (File.Exists(newHost)) ReplaceRunningHost(newHost);

        try { Directory.Delete(tmp, true); } catch { }
        var st = Status();
        st["ok"] = true;
        st["applied"] = true;
        st["count"] = updated.Count;
        st["paths"] = updated;
        return st;
    }

    static string FindManifestRoot(string dir)
    {
        if (File.Exists(Path.Combine(dir, "manifest.json"))) return dir;
        if (!Directory.Exists(dir)) return null;
        foreach (var sub in Directory.GetDirectories(dir))
            if (File.Exists(Path.Combine(sub, "manifest.json"))) return sub;
        return null;
    }

    static List<string> CollectUpdateTargets()
    {
        var list = new List<string>();
        var canonical = Path.Combine(AppDir, "app");
        if (File.Exists(Path.Combine(canonical, "manifest.json"))) AddUnique(list, canonical);
        foreach (var p in LoadSavedPaths())
            if (File.Exists(Path.Combine(p, "manifest.json"))) AddUnique(list, p);
        foreach (var p in FindBrowserExtDirs()) AddUnique(list, p);
        foreach (var p in GuessUserExtDirs())
            if (File.Exists(Path.Combine(p, "manifest.json"))) AddUnique(list, p);
        return list;
    }

    static List<string> GuessUserExtDirs()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return new List<string>
        {
            Path.Combine(home, "StarlitVPN"),
            Path.Combine(home, "StarlitVPN", "extension"),
            Path.Combine(home, "Downloads", "StarlitVPN"),
            Path.Combine(home, "Downloads", "StarlitVPN", "extension"),
            Path.Combine(home, "Desktop", "StarlitVPN"),
            Path.Combine(home, "Desktop", "StarlitVPN", "extension"),
            Path.Combine(home, "Documents", "StarlitVPN"),
            Path.Combine(home, "Documents", "StarlitVPN", "extension")
        };
    }

    static void AddUnique(List<string> list, string dir)
    {
        if (string.IsNullOrEmpty(dir)) return;
        try
        {
            var full = Path.GetFullPath(dir);
            foreach (var p in list)
                if (PathsEqual(p, full)) return;
            list.Add(full);
        }
        catch { }
    }

    static List<string> FindBrowserExtDirs()
    {
        var found = new List<string>();
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var roots = new[]
        {
            Path.Combine(local, @"Google\Chrome\User Data"),
            Path.Combine(local, @"Microsoft\Edge\User Data"),
            Path.Combine(local, @"BraveSoftware\Brave-Browser\User Data"),
            Path.Combine(local, @"Chromium\User Data"),
            Path.Combine(local, @"Yandex\YandexBrowser\User Data")
        };
        foreach (var root in roots)
        {
            if (!Directory.Exists(root)) continue;
            try
            {
                foreach (var profile in Directory.GetDirectories(root))
                {
                    ScanPrefFile(Path.Combine(profile, "Preferences"), found);
                    ScanPrefFile(Path.Combine(profile, "Secure Preferences"), found);
                }
            }
            catch { }
        }
        var ff = Path.Combine(roaming, @"Mozilla\Firefox\Profiles");
        if (Directory.Exists(ff))
        {
            try
            {
                foreach (var profile in Directory.GetDirectories(ff))
                    ScanPrefFile(Path.Combine(profile, "extensions.json"), found);
            }
            catch { }
        }
        return found;
    }

    static void ScanPrefFile(string file, List<string> found)
    {
        if (!File.Exists(file)) return;
        string text;
        try { text = File.ReadAllText(file, Encoding.UTF8); }
        catch { return; }
        var id = ChromeId;
        var idx = 0;
        while (true)
        {
            idx = text.IndexOf(id, idx, StringComparison.OrdinalIgnoreCase);
            if (idx < 0) break;
            var start = Math.Max(0, idx - 800);
            var len = Math.Min(5000, text.Length - start);
            var slice = text.Substring(start, len);
            foreach (Match m in Regex.Matches(slice, "\"path\"\\s*:\\s*\"((?:\\\\\\\\.|[^\"\\\\])*)\""))
            {
                var raw = m.Groups[1].Value.Replace("\\\\", "\\");
                if (Directory.Exists(raw) && File.Exists(Path.Combine(raw, "manifest.json")))
                    AddUnique(found, raw);
            }
            idx += id.Length;
        }
        if (text.IndexOf(FirefoxId, StringComparison.OrdinalIgnoreCase) >= 0)
        {
            foreach (Match m in Regex.Matches(text, "\"path\"\\s*:\\s*\"((?:\\\\\\\\.|[^\"\\\\])*)\""))
            {
                var raw = m.Groups[1].Value.Replace("\\\\", "\\");
                if (Directory.Exists(raw) && File.Exists(Path.Combine(raw, "manifest.json")))
                    AddUnique(found, raw);
            }
        }
    }

    static void CopyTree(string src, string dest)
    {
        foreach (var dir in Directory.GetDirectories(src, "*", SearchOption.AllDirectories))
        {
            var rel = dir.Substring(src.Length).TrimStart('\\', '/');
            Directory.CreateDirectory(Path.Combine(dest, rel));
        }
        foreach (var file in Directory.GetFiles(src, "*", SearchOption.AllDirectories))
        {
            var rel = file.Substring(src.Length).TrimStart('\\', '/');
            var to = Path.Combine(dest, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(to));
            try { File.Copy(file, to, true); }
            catch (Exception ex) { Log("skip " + to + " " + ex.Message); }
        }
    }

    static void ReplaceRunningHost(string newHost)
    {
        var dest = Path.Combine(AppDir, "host.exe");
        try
        {
            File.Copy(newHost, dest, true);
            return;
        }
        catch { }
        var pending = Path.Combine(AppDir, "host.exe.new");
        try { File.Copy(newHost, pending, true); }
        catch (Exception ex) { Log("host.exe.new " + ex.Message); return; }
        var cmd = "cmd.exe";
        var args = "/c ping 127.0.0.1 -n 3 >nul & move /y \"" + pending + "\" \"" + dest + "\"";
        int pid;
        StartDetached(cmd, "cmd.exe " + args, AppDir, out pid);
    }

    static string Str(Dictionary<string, object> msg, string key)
    {
        object v;
        if (msg == null || !msg.TryGetValue(key, out v) || v == null) return "";
        return Convert.ToString(v);
    }

    static int IntVal(Dictionary<string, object> msg, string key)
    {
        object v;
        if (msg == null || !msg.TryGetValue(key, out v) || v == null) return 0;
        try { return Convert.ToInt32(v); } catch { return 0; }
    }

    static bool PathsEqual(string a, string b)
    {
        try { return string.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string lpApplicationName, StringBuilder lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll")]
    static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);

    static void HideConsole()
    {
        try
        {
            var hwnd = GetConsoleWindow();
            if (hwnd != IntPtr.Zero) ShowWindow(hwnd, 0);
        }
        catch { }
    }
}
