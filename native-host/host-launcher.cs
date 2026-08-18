using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

internal static class Program
{
    static int Main()
    {
        try
        {
            var dir = AppDomain.CurrentDomain.BaseDirectory;
            var script = Path.Combine(dir, "host.py");
            if (!File.Exists(script))
            {
                Console.Error.WriteLine("host.py not found");
                return 2;
            }

            string fileName;
            string args;
            var hintFile = Path.Combine(dir, "python.path");
            var hinted = File.Exists(hintFile) ? File.ReadAllText(hintFile).Trim().Trim('"') : null;
            if (!string.IsNullOrEmpty(hinted) && File.Exists(hinted))
            {
                fileName = hinted;
                args = "-u \"" + script + "\"";
            }
            else
            {
                var pyLauncher = FindOnPath("py.exe");
                var python = FindOnPath("python.exe") ?? FindOnPath("python3.exe");
                if (pyLauncher != null)
                {
                    fileName = pyLauncher;
                    args = "-3 -u \"" + script + "\"";
                }
                else if (python != null)
                {
                    fileName = python;
                    args = "-u \"" + script + "\"";
                }
                else
                {
                    Console.Error.WriteLine("Python 3 not found");
                    return 3;
                }
            }

            var psi = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = args,
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WorkingDirectory = dir
            };
            var proc = new Process { StartInfo = psi };
            proc.Start();
            proc.StandardInput.BaseStream.Flush();

            var tIn = new Thread(() => Copy(Console.OpenStandardInput(), proc.StandardInput.BaseStream));
            var tOut = new Thread(() => Copy(proc.StandardOutput.BaseStream, Console.OpenStandardOutput()));
            var tErr = new Thread(() => Copy(proc.StandardError.BaseStream, Console.OpenStandardError()));
            tIn.IsBackground = true;
            tOut.IsBackground = true;
            tErr.IsBackground = true;
            tIn.Start();
            tOut.Start();
            tErr.Start();
            proc.WaitForExit();
            return proc.ExitCode;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    static void Copy(Stream from, Stream to)
    {
        var buf = new byte[65536];
        try
        {
            int n;
            while ((n = from.Read(buf, 0, buf.Length)) > 0)
            {
                to.Write(buf, 0, n);
                to.Flush();
            }
        }
        catch
        {
            try { to.Close(); } catch { /* ignore */ }
        }
    }

    static string FindOnPath(string name)
    {
        var paths = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator);
        foreach (var path in paths)
        {
            try
            {
                var candidate = Path.Combine(path.Trim('"'), name);
                if (File.Exists(candidate)) return candidate;
            }
            catch { /* ignore */ }
        }
        return null;
    }
}
