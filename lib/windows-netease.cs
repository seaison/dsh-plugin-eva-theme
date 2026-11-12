// NetEase window and Core Audio session probe, adapted from powang233/dsh-plugin-eva-theme (MIT).
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace EvaMedia {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class DeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int flow, int state, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDevice endpoint);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IDevice {
        [PreserveSig] int Activate(ref Guid iid, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object value);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface ISessionManager {
        [PreserveSig] int GetAudioSessionControl(ref Guid guid, int flags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(ref Guid guid, int flags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out ISessionEnumerator sessions);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface ISessionEnumerator {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
    }

    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface ISessionControl {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
        [PreserveSig] int GetGroupingParam(out Guid group);
        [PreserveSig] int SetGroupingParam(ref Guid group, ref Guid context);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint pid);
    }

    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioMeter {
        [PreserveSig] int GetPeakValue(out float peak);
    }

    public static class NetEase {
        private delegate bool EnumWindow(IntPtr window, IntPtr data);
        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow visit, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int count);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
        [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);

        public static string FindTrack(uint[] processIds) {
            string track = null;
            EnumWindows((window, data) => {
                uint pid;
                GetWindowThreadProcessId(window, out pid);
                if (Array.IndexOf(processIds, pid) < 0) return true;
                var cls = new StringBuilder(128);
                GetClassName(window, cls, cls.Capacity);
                if (cls.ToString() != "OrpheusBrowserHost") return true;
                var title = new StringBuilder(1024);
                GetWindowText(window, title, title.Capacity);
                if (title.ToString().IndexOf(" - ", StringComparison.Ordinal) < 0) return true;
                track = title.ToString();
                return false;
            }, IntPtr.Zero);
            return track;
        }

        public static bool HasAudio(uint[] processIds) {
            IDeviceEnumerator enumerator = null;
            IDevice device = null;
            object manager = null;
            ISessionEnumerator sessions = null;
            try {
                enumerator = (IDeviceEnumerator)new DeviceEnumerator();
                if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) != 0) return false;
                Guid iid = typeof(ISessionManager).GUID;
                if (device.Activate(ref iid, 23, IntPtr.Zero, out manager) != 0) return false;
                if (((ISessionManager)manager).GetSessionEnumerator(out sessions) != 0) return false;
                int count;
                if (sessions.GetCount(out count) != 0) return false;
                for (int i = 0; i < count; i++) {
                    object session = null;
                    try {
                        if (sessions.GetSession(i, out session) != 0) continue;
                        var control = session as ISessionControl;
                        uint pid;
                        if (control == null || control.GetProcessId(out pid) != 0 || Array.IndexOf(processIds, pid) < 0) continue;
                        var meter = session as IAudioMeter;
                        float peak;
                        if (meter != null && meter.GetPeakValue(out peak) == 0 && peak > 0.001f) return true;
                    } finally { Release(session); }
                }
                return false;
            } catch (COMException) {
                return false;
            } finally {
                Release(sessions);
                Release(manager);
                Release(device);
                Release(enumerator);
            }
        }

        private static void Release(object value) {
            if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value);
        }

        public static void MediaKey(string action) {
            byte key;
            switch (action) {
                case "playpause": key = 0xB3; break;
                case "next": key = 0xB0; break;
                case "previous": key = 0xB1; break;
                default: throw new ArgumentException("Unknown media action", "action");
            }
            keybd_event(key, 0, 0, UIntPtr.Zero);
            Thread.Sleep(40);
            keybd_event(key, 0, 2, UIntPtr.Zero);
        }
    }
}
