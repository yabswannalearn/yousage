# Windows integration check: observes the real app and its background CLI tree.
# Example: ./tests/console-windows.ps1 -AppPath D:/Apps/YouSage/yousage.exe -RestartApp
# This reads live quotas using existing sign-ins; it does not switch accounts.
param([Parameter(Mandatory)][string]$AppPath, [ValidateRange(5, 600)][int]$Duration = 80, [switch]$RestartApp)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
public static class YouSageConsoleRegression {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Entry { public uint size,usage,pid; public IntPtr heap; public uint module,threads,parent; public int priority; public uint flags; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string name; }
 [StructLayout(LayoutKind.Sequential)] struct Msg { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x,y; public uint extra; }
 delegate void Callback(IntPtr hook,uint evt,IntPtr hwnd,int obj,int child,uint thread,uint time);
 [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr h,ref Entry e);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr h,ref Entry e);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,Callback callback,uint pid,uint thread,uint flags);
 [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr h);
 [DllImport("user32.dll")] static extern bool PeekMessageW(out Msg msg,IntPtr hwnd,uint min,uint max,uint remove);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd,StringBuilder text,int length);
 static Dictionary<uint,(uint parent,string name)> processes = new Dictionary<uint,(uint,string)>();
 static HashSet<uint> reported = new HashSet<uint>();
 static uint root; static int failures; static int quotaStarts; static DateTime lastConsole;
 static bool Owned(uint pid) { for(int i=0;i<64;i++){if(pid==root)return true; if(!processes.TryGetValue(pid,out var p)||p.parent==pid)return false;pid=p.parent;} return false; }
 static string Chain(uint pid) { var parts=new List<string>(); for(int i=0;i<20;i++){if(!processes.TryGetValue(pid,out var p))break;parts.Add(p.name+":"+pid);if(pid==root||p.parent==pid)break;pid=p.parent;} return string.Join(" <- ",parts); }
 static void Snapshot(){var h=CreateToolhelp32Snapshot(2,0);if(h==new IntPtr(-1))return;try{var e=new Entry{size=(uint)Marshal.SizeOf<Entry>()};if(Process32FirstW(h,ref e))do{processes[e.pid]=(e.parent,e.name);}while(Process32NextW(h,ref e));}finally{CloseHandle(h);} foreach(var p in processes){if(Owned(p.Key)&&reported.Add(p.Key)){Console.WriteLine("PROCESS "+Chain(p.Key)); if(p.Value.name=="conhost.exe") lastConsole=DateTime.UtcNow; if(p.Value.name=="agy.exe"&&processes.TryGetValue(p.Value.parent,out var directParent)&&directParent.name!="agy.exe") quotaStarts++; if(p.Value.name=="agy.exe"&&processes.TryGetValue(p.Value.parent,out var parent)&&parent.name=="agy.exe"){failures++;Console.WriteLine("FAIL: quota check launched an internal agy child (background updater)");}}}}
 static void Event(IntPtr hook,uint evt,IntPtr hwnd,int obj,int child,uint thread,uint time) {
  if(obj!=0||child!=0||hwnd==IntPtr.Zero)return;
  var text=new StringBuilder(256);GetClassNameW(hwnd,text,256);var cls=text.ToString();
  if(cls!="ConsoleWindowClass"&&cls!="CASCADIA_HOSTING_WINDOW_CLASS")return;
  GetWindowThreadProcessId(hwnd,out var pid); Snapshot();
  if(evt==0x8002&&IsWindowVisible(hwnd)&&(Owned(pid)||(cls=="CASCADIA_HOSTING_WINDOW_CLASS"&&DateTime.UtcNow-lastConsole<TimeSpan.FromSeconds(3)))){failures++;Console.WriteLine("FAIL: visible console/terminal appeared during a background CLI launch");}
  Console.WriteLine("WINDOW "+DateTime.UtcNow.ToString("O")+" event="+evt+" hwnd="+hwnd+" visible="+IsWindowVisible(hwnd)+" owned="+Owned(pid)+" class="+cls+" chain="+Chain(pid));
 }
 public static int Run(int pid,int duration){ root=(uint)pid;Snapshot();Callback callback=Event;var hook=SetWinEventHook(0x8002,0x8003,IntPtr.Zero,callback,0,0,2);if(hook==IntPtr.Zero)throw new Exception("Event hook unavailable");try{var end=DateTime.UtcNow.AddSeconds(duration);while(DateTime.UtcNow<end){Snapshot();while(PeekMessageW(out var msg,IntPtr.Zero,0,0,1)){} Thread.Sleep(5);}}finally{UnhookWinEvent(hook);GC.KeepAlive(callback);} return quotaStarts==0 ? -1 : failures;}
}
'@
$localExe = (Resolve-Path -LiteralPath $AppPath).Path
$running = @(Get-CimInstance Win32_Process -Filter "name='yousage.exe'" | Where-Object ExecutablePath -eq $localExe)
if ($RestartApp) {
    foreach ($copy in $running) { $old = Get-Process -Id $copy.ProcessId; Stop-Process -Id $copy.ProcessId; $old.WaitForExit() }
    $running = @()
}
if ($running.Count -eq 1) { $started = Get-Process -Id $running[0].ProcessId }
elseif ($running.Count -eq 0) { $started = Start-Process -FilePath $localExe -WorkingDirectory (Split-Path -Parent $localExe) -WindowStyle Hidden -PassThru }
else { throw 'More than one matching app is running.' }
$failures = [YouSageConsoleRegression]::Run($started.Id, $Duration)
if ($started.HasExited) { throw 'The target app exited; close other YouSage copies before running this check.' }
if ($failures -lt 0) { throw 'No Antigravity quota process was observed. Increase Duration or restart the app with -RestartApp.' }
if ($failures -gt 0) { throw "$failures visible console events or background updater processes detected." }
Write-Output "PASS: no visible console events or internal updater launches in $Duration seconds."
