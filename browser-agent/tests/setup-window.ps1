$ErrorActionPreference = 'Stop'
$folder = Join-Path $env:TEMP ('sm-setup-ui-' + [Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path (Join-Path $folder 'dist') -Force)
Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $folder 'node.exe')
$fixture = @'
let input = '';
process.stdin.on('data', data => input += data);
process.stdin.on('end', () => {
  const body = JSON.parse(input);
  if(body.username !== 'fixture' || body.password !== 'test-password') process.exit(1);
  for(const stage of ['login','install','connect','connected']) console.log(JSON.stringify({stage}));
});
'@
[IO.File]::WriteAllText((Join-Path $folder 'dist/main.js'), $fixture)
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../setup.ps1'))
$test = @'
$script:testTimer = New-Object System.Windows.Forms.Timer
$script:testTimer.Interval = 200
$script:testStarted = [DateTime]::UtcNow
$script:testTimer.Add_Tick({
    if ($script:connected -and $button.Enabled) {
        $bitmap = New-Object System.Drawing.Bitmap($form.Width, $form.Height)
        $form.DrawToBitmap($bitmap, $form.ClientRectangle)
        $bitmap.Save((Join-Path $PSScriptRoot 'setup-result.png'))
        $bitmap.Dispose()
        $script:testTimer.Stop()
        $form.Close()
    }
    if (([DateTime]::UtcNow - $script:testStarted).TotalSeconds -gt 15) {
        $script:testTimer.Stop()
        $script:testError = $status.Text
        $form.Close()
    }
})
$form.Add_Shown({
    if (!$password.UseSystemPasswordChar) { throw 'Password should be masked' }
    $username.Text = 'fixture'
    $password.Text = 'test-password'
    $button.PerformClick()
    $script:testTimer.Start()
})
[void]$form.ShowDialog()
if (!$script:connected) { throw ('No connected state: ' + $script:testError) }
Write-Output 'PASS WinForms login button, hidden password, install progress and connected state.'
'@
$source = $source.Replace('[void]$form.ShowDialog()', $test)
$scriptFile = Join-Path $folder 'setup.ps1'
[IO.File]::WriteAllText($scriptFile, $source, (New-Object System.Text.UTF8Encoding($true)))
& powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File $scriptFile
if ($LASTEXITCODE -ne 0) { throw 'UI fixture failed' }
Write-Output (Join-Path $folder 'setup-result.png')
