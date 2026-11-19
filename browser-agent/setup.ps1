Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Social Manager - Setup'
$form.ClientSize = New-Object System.Drawing.Size(440, 350)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$form.BackColor = [System.Drawing.Color]::White

function Add-Label($text, $top) {
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $text
    $label.Location = New-Object System.Drawing.Point(30, $top)
    $label.Size = New-Object System.Drawing.Size(380, 25)
    $form.Controls.Add($label)
}
Add-Label 'Đăng nhập tài khoản Social Manager' 25
Add-Label 'Tài khoản' 70
$username = New-Object System.Windows.Forms.TextBox
$username.Location = New-Object System.Drawing.Point(30, 98)
$username.Size = New-Object System.Drawing.Size(380, 28)
$username.MaxLength = 32
$form.Controls.Add($username)
Add-Label 'Mật khẩu' 140
$password = New-Object System.Windows.Forms.TextBox
$password.Location = New-Object System.Drawing.Point(30, 168)
$password.Size = New-Object System.Drawing.Size(380, 28)
$password.UseSystemPasswordChar = $true
$password.MaxLength = 200
$form.Controls.Add($password)
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Đăng nhập'
$button.Location = New-Object System.Drawing.Point(30, 220)
$button.Size = New-Object System.Drawing.Size(380, 40)
$button.BackColor = [System.Drawing.Color]::FromArgb(15, 123, 95)
$button.ForeColor = [System.Drawing.Color]::White
$button.FlatStyle = 'Flat'
$form.Controls.Add($button)
$form.AcceptButton = $button
$status = New-Object System.Windows.Forms.Label
$status.Location = New-Object System.Drawing.Point(30, 275)
$status.Size = New-Object System.Drawing.Size(380, 65)
$status.Text = 'Đăng nhập để tự cài đặt và kết nối máy với website.'
$form.Controls.Add($status)
$script:worker = $null
$script:readTask = $null
$script:failed = $false
$script:connected = $false
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 150

function Show-WorkerLine($line) {
    if (!$line -or !$line.StartsWith('{')) { return }
    try { $event = $line | ConvertFrom-Json } catch { return }
    switch ($event.stage) {
        'login' { $status.Text = 'Đang đăng nhập...' }
        'install' { $status.Text = 'Đang cài trình duyệt. Lần đầu cần tải khoảng 1,4 GB. Vui lòng đợi...' }
        'connect' { $status.Text = 'Cài đặt xong. Đang kết nối với website...' }
        'connected' { $script:connected = $true; $status.Text = 'Đã kết nối. Máy đã sẵn sàng trên website. Bạn có thể đóng cửa sổ này.' }
    }
    if ($event.error) {
        $script:failed = $true
        $messages = @{
            INVALID_LOGIN = 'Tài khoản hoặc mật khẩu không đúng.'
            LOGIN_RATE_LIMIT = 'Thử quá nhiều lần. Vui lòng đợi 5 phút.'
            AGENT_ALREADY_RUNNING = 'Chương trình đang chạy. Máy đang kết nối hoặc chờ mạng. Xem trạng thái trên website.'
            BROWSER_DOWNLOAD_FAILED = 'Tải trình duyệt thất bại. Kiểm tra mạng rồi bấm Đăng nhập để thử lại.'
            CONNECT_PENDING = 'Đã cài đặt. Chương trình đang thử kết nối nền. Kiểm tra mạng và xem trạng thái trên website.'
            NETWORK = 'Chưa kết nối được. Kiểm tra mạng rồi thử lại.'
        }
        $status.Text = $messages[$event.error]
        if (!$status.Text) { $status.Text = $messages.NETWORK }
    }
}

$timer.Add_Tick({
    while ($script:readTask -and $script:readTask.IsCompleted) {
        $line = $script:readTask.GetAwaiter().GetResult()
        if ($null -eq $line) { $script:readTask = $null; break }
        Show-WorkerLine $line
        $script:readTask = $script:worker.StandardOutput.ReadLineAsync()
    }
    if ($script:worker -and $script:worker.HasExited -and !$script:readTask) {
        $timer.Stop()
        $form.ControlBox = $true
        $username.Enabled = $true
        $password.Enabled = $true
        $button.Enabled = $true
        if ($script:connected) { $button.Text = 'Mở website' }
        elseif (!$script:failed) { $status.Text = 'Cài đặt chưa hoàn tất. Vui lòng thử lại.' }
        $script:worker.Dispose()
        $script:worker = $null
    }
})
$button.Add_Click({
    if ($script:connected) {
        [System.Diagnostics.Process]::Start('https://social-manager.congtrieugvm.workers.dev/browser') | Out-Null
        return
    }
    if (!$username.Text.Trim() -or !$password.Text) { $status.Text = 'Nhập tài khoản và mật khẩu website.'; return }
    $script:failed = $false
    try {
        $info = New-Object System.Diagnostics.ProcessStartInfo
        $info.FileName = Join-Path $PSScriptRoot 'node.exe'
        $info.Arguments = 'dist/main.js setup-window'
        $info.WorkingDirectory = $PSScriptRoot
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardInput = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.StandardOutputEncoding = [System.Text.Encoding]::UTF8
        $script:worker = New-Object System.Diagnostics.Process
        $script:worker.StartInfo = $info
        [void]$script:worker.Start()
        # Drain diagnostic output without putting secrets or raw browser errors in the UI.
        $script:worker.BeginErrorReadLine()
        $payload = @{ username = $username.Text.Trim(); password = $password.Text } | ConvertTo-Json -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
        $script:worker.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        $script:worker.StandardInput.Close()
        [Array]::Clear($bytes, 0, $bytes.Length)
        $payload = $null
        $password.Clear()
        $username.Enabled = $false
        $password.Enabled = $false
        $button.Enabled = $false
        $form.ControlBox = $false
        $status.Text = 'Đang đăng nhập...'
        $script:readTask = $script:worker.StandardOutput.ReadLineAsync()
        $timer.Start()
    } catch {
        $status.Text = 'Không mở được bộ cài. Hãy giải nén đầy đủ gói Windows rồi chạy Setup.'
        $button.Enabled = $true
        $form.ControlBox = $true
    }
})
$form.Add_FormClosed({ $timer.Dispose() })
[void]$form.ShowDialog()
