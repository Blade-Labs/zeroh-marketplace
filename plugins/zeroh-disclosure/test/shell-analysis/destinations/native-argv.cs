// SPDX-License-Identifier: MIT
using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;
using System.Diagnostics;
using System.Text;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using System.Management.Automation.Language;

// A console executable, never a batch wrapper: PowerShell passes native argv
// directly to this entry point without a second cmd.exe parse.
public static class NativeArgv {
    private static readonly Stopwatch lifetime = Stopwatch.StartNew();
    private static void Stage(string stage) {
        string root = Environment.GetEnvironmentVariable("ZEROH_ORACLE_BRIDGE_DIAGNOSTICS");
        if (String.IsNullOrEmpty(root)) return;
        // One file per PID avoids concurrent append contention. Only fixed
        // stage names, PIDs, counts, exit codes and Win32 errors are recorded.
        try {
            Directory.CreateDirectory(root);
            File.AppendAllText(Path.Combine(root, "bridge-" + Process.GetCurrentProcess().Id + ".log"),
                DateTime.UtcNow.ToString("o") + " " + stage + "\n");
        } catch (IOException) {} catch (UnauthorizedAccessException) {}
    }
    // Assign the bridge itself before starting children. If Node times it out,
    // closing the last job handle terminates every descendant (including native
    // printers). A surviving powershell.exe otherwise holds the fixture cwd.
    // Keep this non-inheritable handle open until process exit, not a using scope
    // that would terminate the bridge before its exit status reaches Node.
    private static IntPtr childJob;
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters {
        public ulong ReadOperations, WriteOperations, OtherOperations;
        public ulong ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [StructLayout(LayoutKind.Sequential)]
    private struct JobAccounting {
        public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(IntPtr job, int kind, out JobAccounting info, uint size, IntPtr length);
    private static void WaitOwnedChildren(Process child) {
        if (childJob == IntPtr.Zero) return;
        var clock = Stopwatch.StartNew();
        while (true) {
            JobAccounting info;
            if (!QueryInformationJobObject(childJob, 1, out info, (uint)Marshal.SizeOf(typeof(JobAccounting)), IntPtr.Zero))
                throw new InvalidOperationException("Fixture job accounting failed");
            // The bridge itself is the one permitted surviving job member.
            if (info.ActiveProcesses <= 1) {
                Stage("child tree drained");
                return;
            }
            if (clock.ElapsedMilliseconds >= 3000) {
                Stage("child tree leak active=" + (info.ActiveProcesses - 1));
                ChildTree(child);
                throw new InvalidOperationException("Fixture descendant process leak");
            }
            System.Threading.Thread.Sleep(50);
        }
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry {
        public uint Size, Usage, Pid;
        public UIntPtr Heap;
        public uint Module, Threads, ParentPid;
        public int Priority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string Executable;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
    private static List<ProcessEntry> ProcessTree(Process child) {
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) {
            Stage("child tree snapshot win32=" + Marshal.GetLastWin32Error());
            throw new InvalidOperationException("Fixture process tree snapshot failed");
        }
        try {
            var entries = new List<ProcessEntry>();
            var entry = new ProcessEntry();
            entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
            if (Process32First(snapshot, ref entry)) {
                do { entries.Add(entry); } while (Process32Next(snapshot, ref entry));
            } else throw new InvalidOperationException("Fixture process tree enumeration failed");
            var owned = new HashSet<uint> { (uint)child.Id };
            bool added;
            do {
                added = false;
                foreach (var item in entries)
                    if (owned.Contains(item.ParentPid) && owned.Add(item.Pid)) added = true;
            } while (added);
            return entries.FindAll(item => owned.Contains(item.Pid));
        } finally { CloseHandle(snapshot); }
    }
    private static void ChildTree(Process child) {
        if (String.IsNullOrEmpty(Environment.GetEnvironmentVariable("ZEROH_ORACLE_BRIDGE_DIAGNOSTICS"))) return;
        foreach (var item in ProcessTree(child))
            Stage("child tree pid=" + item.Pid + " parent=" + item.ParentPid + " program=" + item.Executable);
    }
    private static bool OwnChildren() {
        childJob = CreateJobObject(IntPtr.Zero, null);
        var limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (Environment.GetEnvironmentVariable("ZEROH_ORACLE_FORCE_JOB_FALLBACK") == "1" ||
            childJob == IntPtr.Zero ||
            !SetInformationJobObject(childJob, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))) ||
            !AssignProcessToJobObject(childJob, Process.GetCurrentProcess().Handle)) {
            int error = Marshal.GetLastWin32Error();
            if (childJob != IntPtr.Zero) CloseHandle(childJob);
            childJob = IntPtr.Zero;
            Stage("job fallback win32=" + error);
            return false;
        }
        Stage("job assigned");
        return true;
    }
    private static bool KillTree(Process child) {
        if (child.HasExited) {
            // Keep the root process handle open: Windows cannot reuse its PID
            // while the snapshot identifies descendants by their parent PID.
            bool leaked = false;
            foreach (var item in ProcessTree(child)) {
                if (item.Pid == (uint)child.Id) continue;
                Process descendant;
                try { descendant = Process.GetProcessById((int)item.Pid); }
                catch (ArgumentException) { continue; }
                using (descendant) {
                    if (descendant.HasExited) continue;
                    leaked = true;
                    Stage("child tree leak active=1 pid=" + descendant.Id);
                    KillTree(descendant);
                }
            }
            return leaked;
        }
        var info = new ProcessStartInfo(Path.Combine(Environment.GetEnvironmentVariable("SystemRoot"),
            "System32", "taskkill.exe"), "/F /T /PID " + child.Id);
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        using (var killer = Process.Start(info)) {
            var output = killer.StandardOutput.ReadToEndAsync();
            var error = killer.StandardError.ReadToEndAsync();
            if (!killer.WaitForExit(3000)) killer.Kill();
            Task.WaitAll(new[] { output, error }, 1000);
            Stage("tree cleanup exit=" + (killer.HasExited ? killer.ExitCode.ToString() : "pending"));
        }
        if (!child.HasExited) child.Kill();
        if (!child.WaitForExit(3000))
            throw new InvalidOperationException("Fixture child survived tree cleanup");
        // taskkill completion does not prove every descendant has exited yet.
        return KillTree(child);
    }
    private static void Watch(string[] args) {
        // This process is outside our failed job. Capture process handles before
        // acknowledging readiness, so parent death cannot strand the child.
        Process child;
        try { child = Process.GetProcessById(Int32.Parse(args[2])); }
        catch (ArgumentException) { return; } // Child already finished.
        using (child) {
            Process parent = null;
            try {
                parent = Process.GetProcessById(Int32.Parse(args[1]));
                if (parent.Handle == IntPtr.Zero)
                    throw new InvalidOperationException("Fixture parent handle missing");
            } catch (SystemException) {
                if (parent != null) parent.Dispose();
                KillTree(child); // Parent died before the readiness handshake.
                return;
            }
            using (parent) {
                try {
                    if (child.Handle == IntPtr.Zero)
                        throw new InvalidOperationException("Fixture child handle missing");
                    Console.WriteLine("ready");
                    Console.Out.Flush();
                    var clock = Stopwatch.StartNew();
                    while (!child.HasExited && !parent.WaitForExit(100) && clock.ElapsedMilliseconds < 150000) {}
                } finally {
                    // Also clean up if parent death breaks the readiness pipe.
                    try { ChildTree(child); }
                    finally { if (KillTree(child)) Environment.ExitCode = 1; }
                }
            }
        }
    }
    private static int RemainingChildTimeout() {
        int timeout;
        if (!Int32.TryParse(Environment.GetEnvironmentVariable("ZEROH_ORACLE_CHILD_TIMEOUT_MS"), out timeout) || timeout <= 0)
            timeout = 120000;
        // Script preparation and the fallback handshake share the caller's
        // child budget; its existing cleanup reservation remains unchanged.
        return Math.Max(1, timeout - (int)lifetime.ElapsedMilliseconds);
    }
    private static Process WatchChild(Process child) {
        var info = new ProcessStartInfo(Environment.GetCommandLineArgs()[0],
            "--zeroh-watch " + Process.GetCurrentProcess().Id + " " + child.Id);
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardInput = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        // The watcher survives parent death. It must not itself retain the
        // private fixture cwd while taskkill/handle cleanup finishes.
        info.WorkingDirectory = Environment.GetEnvironmentVariable("SystemRoot");
        // Fixture-only scheduling control: exercise a real root exit before
        // launching its watcher, rather than hoping CPU contention causes it.
        if (Environment.GetEnvironmentVariable("ZEROH_ORACLE_WATCHER_AFTER_ROOT_EXIT") == "1") {
            if (!child.WaitForExit(RemainingChildTimeout())) throw new TimeoutException("Fixture root did not exit before watcher startup");
            Stage("root exited before watcher start");
        }
        var watcher = Process.Start(info);
        watcher.StandardInput.Close();
        watcher.StandardError.ReadToEndAsync();
        var ready = watcher.StandardOutput.ReadLineAsync();
        if (!ready.Wait(3000) || ready.Result != "ready") {
            // A short-lived root can exit before the watcher opens it while
            // detached descendants still hold the private cwd. The bridge's
            // root handle prevents PID reuse while we inspect that tree.
            if (child.HasExited) {
                bool leaked = KillTree(child);
                if (!watcher.WaitForExit(4000)) {
                    watcher.Kill();
                    watcher.Dispose();
                    throw new TimeoutException("Fixture cleanup watcher timed out");
                }
                bool watcherFailed = watcher.ExitCode != 0;
                watcher.Dispose();
                if (leaked || watcherFailed) throw new InvalidOperationException("Fixture descendant process leak");
                return null;
            }
            KillTree(child);
            if (!watcher.HasExited) watcher.Kill();
            watcher.Dispose();
            throw new InvalidOperationException("Fixture cleanup watcher failed to start");
        }
        Stage("cleanup watcher ready pid=" + watcher.Id);
        return watcher;
    }
    // The Windows CRT quoting algorithm. cmd source is kept in a .cmd file;
    // this quotes only native program arguments, never shell source.
    private static string Quote(string value) {
        var text = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            text.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            text.Append(c);
            slashes = 0;
        }
        text.Append('\\', slashes * 2);
        return text.Append('"').ToString();
    }
    private static string ReadInput() {
        // A native command with no pipeline input can inherit ConsoleHost's
        // interactive console instead of the bridge's closed pipe. There is no
        // fixture input on that handle. Files/pipes still read all real bytes.
        bool redirected = Console.IsInputRedirected;
        Stage("stdin read start redirected=" + redirected);
        if (!redirected) {
            Stage("stdin read done bytes=0 console");
            return "";
        }
        // Node's transport writes UTF-8, independently of the Windows console
        // codepage. Do not decode parser JSON through Console.In's OEM encoding.
        using (var reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false, true))) {
            string input = reader.ReadToEnd();
            Stage("stdin read done bytes=" + Encoding.UTF8.GetByteCount(input));
            return input;
        }
    }
    private static void Forward(string executable, string[] args, string input = null, string payload = null) {
        var quoted = new List<string>();
        foreach (string arg in args) quoted.Add(Quote(arg));
        var info = new ProcessStartInfo(executable, String.Join(" ", quoted));
        info.UseShellExecute = false;
        // ConsoleHost 5.1 and its native-command processor use Win32 console
        // handles even with redirected streams. Do not detach it with
        // CREATE_NO_WINDOW while the bootstrap changes Console input/output.
        info.RedirectStandardInput = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        if (payload != null) info.EnvironmentVariables["ZEROH_ORACLE_POWERSHELL_INPUT"] = payload;
        // PowerShell's special folders must also remain in the isolated home.
        string home = Environment.GetEnvironmentVariable("HOME");
        foreach (string name in new[] { "APPDATA", "LOCALAPPDATA" }) {
            if (String.IsNullOrEmpty(Environment.GetEnvironmentVariable(name))) {
                string dir = Path.Combine(home, name.ToLowerInvariant());
                Directory.CreateDirectory(dir);
                info.EnvironmentVariables[name] = dir;
            }
        }
        using (var child = Process.Start(info)) {
            Stage("child started pid=" + child.Id);
            try {
                using (var watcher = childJob == IntPtr.Zero ? WatchChild(child) : null) {
                    // Dedicated pumps cannot starve each other in the thread pool.
                    var output = Task.Factory.StartNew(() => child.StandardOutput.BaseStream.CopyTo(Console.OpenStandardOutput()), TaskCreationOptions.LongRunning);
                    var error = Task.Factory.StartNew(() => child.StandardError.BaseStream.CopyTo(Console.OpenStandardError()), TaskCreationOptions.LongRunning);
                    var bytes = Encoding.UTF8.GetBytes(input ?? ReadInput());
                    child.StandardInput.BaseStream.Write(bytes, 0, bytes.Length);
                    child.StandardInput.Close();
                    Stage("child stdin closed bytes=" + bytes.Length);
                    int timeout = RemainingChildTimeout();
                    Stage("child wait ms=" + timeout);
                    if (!child.WaitForExit(timeout)) {
                        Stage("child timeout");
                        ChildTree(child);
                        throw new TimeoutException("Fixture child timed out");
                    }
                    Stage("child exited code=" + child.ExitCode);
                    if (!Task.WaitAll(new[] { output, error }, 3000)) {
                        Stage("output timeout");
                        throw new TimeoutException("Fixture output flush timed out");
                    }
                    Stage("output flushed");
                    Environment.ExitCode = child.ExitCode;
                    if (watcher != null && !watcher.WaitForExit(4000)) {
                        watcher.Kill();
                        throw new TimeoutException("Fixture cleanup watcher timed out");
                    }
                    if (watcher != null && watcher.ExitCode != 0)
                        throw new InvalidOperationException("Fixture descendant process leak");
                }
            } catch {
                KillTree(child);
                throw;
            } finally {
                WaitOwnedChildren(child);
            }
        }
    }
    private static string PsQuote(string text) {
        return "'" + text.Replace("'", "''") + "'";
    }
    private static string PsStage(string stage) {
        return "if ($env:ZEROH_ORACLE_BRIDGE_DIAGNOSTICS) { [IO.File]::AppendAllText(" +
            "[IO.Path]::Combine($env:ZEROH_ORACLE_BRIDGE_DIAGNOSTICS, ('powershell-' + $PID + '.log')), " +
            "([DateTime]::UtcNow.ToString('o') + ' " + stage + "' + [Environment]::NewLine)) }\n";
    }
    private static string Instrument(string source, string status) {
        Token[] tokens;
        ParseError[] errors;
        var ast = Parser.ParseInput(source, out tokens, out errors);
        if (errors.Length != 0 || ast.EndBlock == null ||
            ast.ParamBlock != null || ast.UsingStatements.Count != 0)
            throw new InvalidOperationException("Fixture body cannot be instrumented");
        var text = new StringBuilder(status + " = $true\n");
        int offset = 0, index = 0;
        bool prelude = false;
        foreach (var statement in ast.EndBlock.Statements) {
            string label = "statement=" + index + " kind=" + statement.GetType().Name +
                " start=" + statement.Extent.StartOffset + " end=" + statement.Extent.EndOffset;
            text.Append(source.Substring(offset, statement.Extent.StartOffset - offset));
            bool alias = statement.Extent.Text.StartsWith("Remove-Item Alias:", StringComparison.Ordinal);
            if (prelude && !alias) text.Append("\n" + PsStage("prelude complete"));
            prelude = alias;
            text.Append("\n" + PsStage(label + " before"));
            text.Append(statement.Extent.Text);
            // Save the original final status before diagnostics can change $?.
            // Fixture bodies use argv and $LASTEXITCODE, never intermediate $?.
            text.Append("\n" + status + " = $?\n" + PsStage(label + " after"));
            offset = statement.Extent.EndOffset;
            index++;
        }
        text.Append(source.Substring(offset));
        return text.ToString();
    }
    private static void PowerShell(string[] args) {
        Stage("started argc=" + args.Length);
        OwnChildren();
        string temporary = Environment.GetEnvironmentVariable("TMPDIR");
        if (String.IsNullOrEmpty(temporary)) throw new InvalidOperationException("Isolated TMPDIR required");
        string stem = Path.Combine(temporary, "bridge-" + Guid.NewGuid().ToString("N"));
        string script = stem + ".ps1", payload = stem + ".input", body = stem + ".body.ps1";
        // Read the file-backed transport before launching ConsoleHost. Keep
        // parser input independent of its redirected console input reader.
        string input = ReadInput();
        Stage("input decoded chars=" + input.Length);
        File.WriteAllText(payload, input, new UTF8Encoding(false));
        try {
            int command = Array.FindIndex(args, a => a.Equals("-Command", StringComparison.OrdinalIgnoreCase));
            int file = Array.FindIndex(args, a => a.Equals("-File", StringComparison.OrdinalIgnoreCase));
            string source;
            bool diagnostics = !String.IsNullOrEmpty(Environment.GetEnvironmentVariable("ZEROH_ORACLE_BRIDGE_DIAGNOSTICS"));
            string status = "$__zerohStatus" + Guid.NewGuid().ToString("N");
            if (command >= 0 && command + 2 == args.Length) {
                // Script files avoid the extra native -Command quoting layer;
                // append the exit rule used by -Command for its last statement.
                source = diagnostics ? Instrument(args[command + 1], status) : args[command + 1];
                source += "\nif (" + (diagnostics ? status : "$?") + ") { exit 0 } else { exit 1 }\n";
            } else if (file >= 0 && file + 1 < args.Length) {
                // Dot-source so the original -File body stays in the initial
                // script scope. An extra & scope resurrects AllScope aliases.
                string target = args[file + 1];
                if (diagnostics) {
                    File.WriteAllText(body, Instrument(File.ReadAllText(target), status), new UTF8Encoding(true));
                    target = body;
                }
                var invocation = new StringBuilder(PsStage("file body before") + ". " + PsQuote(target));
                for (int i = file + 2; i < args.Length; i++) invocation.Append(" " + PsQuote(args[i]));
                source = invocation.ToString() + "\n" + PsStage("file body after") + "exit $LASTEXITCODE\n";
            } else throw new InvalidOperationException("Unsupported fixture PowerShell invocation");
            string preamble = PsStage("script entered") +
                "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n" +
                PsStage("output encoding set") +
                PsStage("parser payload ready chars=" + input.Length) +
                PsStage("module warmup before") +
                "Import-Module Microsoft.PowerShell.Management, Microsoft.PowerShell.Utility -ErrorAction Stop\n" +
                PsStage("module warmup after") + PsStage("body before");
            // Windows PowerShell decodes BOM-less script files using the ANSI
            // codepage. The UTF-8 BOM preserves Unicode source on every runner.
            File.WriteAllText(script, preamble + source, new UTF8Encoding(true));
            Stage("script written chars=" + (preamble.Length + source.Length));
            Forward(Path.Combine(Environment.GetEnvironmentVariable("SystemRoot"),
                "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
                new[] { "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script }, "", payload);
        } finally {
            File.Delete(script);
            File.Delete(payload);
            File.Delete(body);
        }
    }
    public static void Main(string[] args) {
        if (args.Length == 3 && args[0] == "--zeroh-watch") {
            Watch(args);
            return;
        }
        var program = Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]);
        Stage("main started program=" + program + " argc=" + args.Length);
        if (program == "fixture-powershell") {
            PowerShell(args);
            return;
        }
        if (program == "pre") {
            File.WriteAllText(args[0], "{\"disableAllHooks\":true}");
            Console.Write(File.ReadAllText(args[0]));
            return;
        }
        string curl = Environment.GetEnvironmentVariable("ZEROH_ORACLE_REAL_CURL");
        if (program == "curl" && !String.IsNullOrEmpty(curl)) {
            Stage("started argc=" + args.Length);
            OwnChildren();
            var pinned = new JavaScriptSerializer().Deserialize<string[]>(Environment.GetEnvironmentVariable("ZEROH_ORACLE_CURL_ARGS"));
            var all = new List<string>(pinned);
            all.AddRange(args);
            Forward(curl, all.ToArray());
            return;
        }
        if (args.Length > 1 && args[0] == "--zeroh-marker") {
            program = args[1];
            var tail = new string[args.Length - 2];
            Array.Copy(args, 2, tail, 0, tail.Length);
            args = tail;
        }
        var record = new Dictionary<string, object> {
            { "program", program },
            { "argv", args },
            { "stdin", ReadInput() }
        };
        File.AppendAllText(Environment.GetEnvironmentVariable("ZEROH_ORACLE_LOG"),
            new JavaScriptSerializer().Serialize(record) + "\n");
        Stage("record written");
    }
}
