using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
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

    static int Main(string[] args)
    {
        Directory.CreateDirectory(AppDir);
        Log("start args=" + string.Join(" ", args ?? new string[0]));
        try
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            var forceRegister = false;
            if (args != null)
            {
                foreach (var a in args)
                    if (a == "--register" || a == "--ensure-core") forceRegister = true;
            }
            if (forceRegister || !InputRedirected())
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
            return 1;
        }
    }

    static bool InputRedirected()
    {
        try { return Console.IsInputRedirected; }
        catch { return false; }
    }

    static void Log(string text)
    {
        try { File.AppendAllText(Path.Combine(AppDir, "host.log"), DateTime.Now.ToString("s") + " " + text + Environment.NewLine); } catch { }
    }

    static void NativeLoop()
    {
        var stdin = Console.OpenStandardInput();
        var stdout = Console.OpenStandardOutput();
        while (true)
        {
            var raw = ReadMessage(stdin);
            if (raw == null) break;
            var reply = Handle(raw);
            WriteMessage(stdout, reply);
        }
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
            if (cmd == "start") return StartXray(Str(msg, "configText"), msg.ContainsKey("config") ? msg["config"] : null, IntVal(msg, "port"));
            if (cmd == "stop") return StopXray();
            if (cmd == "ping") return TcpPing(Str(msg, "host"), IntVal(msg, "port"));
            if (cmd == "fetch") return FetchUrl(Str(msg, "url"), Str(msg, "userAgent"));
            if (cmd == "register") return Register();
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

    static Dictionary<string, object> StartXray(string configText, object configObj, int port)
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
        StopXray();
        var cmd = "\"" + XrayBin() + "\" run -c \"" + CfgPath + "\"";
        int pid;
        if (!StartDetached(XrayBin(), cmd, CoreDir, out pid))
            return Fail("Не удалось запустить Xray");
        File.WriteAllText(PidPath, pid.ToString(), Encoding.UTF8);
        System.Threading.Thread.Sleep(500);
        if (!PidAlive(pid))
            return Fail("Xray сразу завершился");
        var st = OkCore();
        st["running"] = true;
        st["pid"] = pid;
        st["port"] = port;
        return st;
    }

    static Dictionary<string, object> StopXray()
    {
        var pid = CurrentPid();
        if (pid.HasValue)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "taskkill",
                    Arguments = "/PID " + pid.Value + " /F /T",
                    CreateNoWindow = true,
                    UseShellExecute = false
                }).WaitForExit(3000);
            }
            catch { }
        }
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

    static Dictionary<string, object> FetchUrl(string url, string userAgent)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.UserAgent = string.IsNullOrEmpty(userAgent) ? "Happ/3.4.0/windows" : userAgent;
            req.Accept = "*/*";
            req.Timeout = 45000;
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var stream = resp.GetResponseStream())
            using (var ms = new MemoryStream())
            {
                stream.CopyTo(ms);
                var bytes = ms.ToArray();
                var truncated = bytes.Length > 4000000;
                var text = Encoding.UTF8.GetString(bytes, 0, Math.Min(bytes.Length, 4000000));
                var headers = new Dictionary<string, object>();
                foreach (var key in new[] { "subscription-userinfo", "profile-title", "profile-update-interval", "profile-web-page-url" })
                {
                    var v = resp.Headers[key];
                    if (!string.IsNullOrEmpty(v)) headers[key] = v;
                }
                return new Dictionary<string, object>
                {
                    { "ok", true },
                    { "status", (int)resp.StatusCode },
                    { "contentType", resp.ContentType },
                    { "headers", headers },
                    { "body", text },
                    { "truncated", truncated }
                };
            }
        }
        catch (WebException ex)
        {
            var http = ex.Response as HttpWebResponse;
            var body = "";
            if (http != null)
            {
                try { using (var sr = new StreamReader(http.GetResponseStream(), Encoding.UTF8)) body = sr.ReadToEnd(); } catch { }
                return new Dictionary<string, object> { { "ok", false }, { "status", (int)http.StatusCode }, { "error", "HTTP " + (int)http.StatusCode }, { "body", body.Length > 4000 ? body.Substring(0, 4000) : body } };
            }
            return Fail(ex.Message);
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    static Dictionary<string, object> Status()
    {
        var pid = CurrentPid();
        return new Dictionary<string, object>
        {
            { "ok", true },
            { "running", pid.HasValue },
            { "pid", pid.HasValue ? (object)pid.Value : null },
            { "core", CoreInfo() },
            { "missing", false }
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
        if (!CreateProcess(null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, cwd, ref si, out pi))
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

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);
}
