using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace SutraLauncher
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            try
            {
                string appDir = AppDomain.CurrentDomain.BaseDirectory;
                string electronExe = Path.Combine(appDir, "node_modules", "electron", "dist", "electron.exe");
                string mainScript = Path.Combine(appDir, "desktop", "main.cjs");

                if (File.Exists(electronExe) && File.Exists(mainScript))
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = electronExe;
                    psi.Arguments = "\"" + mainScript + "\"";
                    psi.WorkingDirectory = appDir;
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;

                    Process.Start(psi);
                    return;
                }

                // Fallback: Start node server and open browser
                string distServer = Path.Combine(appDir, "dist-server", "index.js");
                if (File.Exists(distServer))
                {
                    ProcessStartInfo nodePsi = new ProcessStartInfo();
                    nodePsi.FileName = "node";
                    nodePsi.Arguments = "\"" + distServer + "\"";
                    nodePsi.WorkingDirectory = appDir;
                    nodePsi.UseShellExecute = false;
                    nodePsi.CreateNoWindow = true;

                    Process.Start(nodePsi);
                    System.Threading.Thread.Sleep(800);
                    Process.Start(new ProcessStartInfo("http://localhost:3001") { UseShellExecute = true });
                    return;
                }

                MessageBox.Show(
                    "Could not find electron.exe or dist-server/index.js at:\n" + appDir + "\n\nPlease run 'npm run build' first.",
                    "SUTRA IDE Launch Notice",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Failed to start SUTRA IDE:\n" + ex.Message,
                    "SUTRA IDE Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }
    }
}
