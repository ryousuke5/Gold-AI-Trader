param(
  [string]$ApiBaseUrl = "https://gold-ai-trader-2uny.onrender.com",
  [string]$ApiKey = $env:GOLD_API_KEY
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ApiKey)) {
  $secure = Read-Host "GOLD_API_KEYを入力してください（入力内容は画面に表示されません）" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

$ApiBaseUrl = $ApiBaseUrl.TrimEnd("/")

$payload = @{
  symbol = "XAUUSD"
  timeframe = "M5"
  features = @{
    bid = 4153.10
    ask = 4153.20
    point = 0.01
    spread = 0.10
    spread_points = 10
    bar_time = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    m5 = @{
      ema20 = 4153.00
      ema50 = 4151.00
      rsi14 = 50
      atr14 = 4.00
      high20 = 4160.00
      low20 = 4140.00
    }
    h1 = @{
      ema20 = 4152.00
      ema50 = 4148.00
      ema200 = 4135.00
      rsi14 = 55
      atr14 = 8.00
    }
    recent_m5 = @()
    recent_h1 = @()
  }
} | ConvertTo-Json -Depth 8

$headers = @{
  "Content-Type" = "application/json"
  "X-Gold-API-Key" = $ApiKey
  "X-Request-Id" = [guid]::NewGuid().ToString()
}

Write-Host ""
Write-Host "=== Gold-AI-Trader AI / Fundamental Test ==="
Write-Host "Endpoint : $ApiBaseUrl/api/gold/ai-test"
Write-Host "Test data: synthetic technical data (NO order is sent)"
Write-Host ""

try {
  $response = Invoke-RestMethod `
    -Uri "$ApiBaseUrl/api/gold/ai-test" `
    -Method Post `
    -Headers $headers `
    -Body $payload `
    -TimeoutSec 100

  Write-Host "HTTP/API: SUCCESS" -ForegroundColor Green
  Write-Host ""

  Write-Host "Candidate : $($response.candidate)"
  Write-Host "Decision  : $($response.decision.decision)"
  Write-Host ("AI called : {0}" -f $response.openai.called)
  Write-Host ("Web search: {0}" -f $response.openai.web_search_used)
  Write-Host ""

  Write-Host "--- Fundamental ---"
  $f = $response.decision.fundamental
  Write-Host "Bias      : $($f.bias)"
  Write-Host "Confidence: $($f.confidence)"
  Write-Host "Freshness : $($f.freshness)"
  Write-Host "Summary   : $($f.summary)"
  Write-Host ""

  Write-Host "--- Sources ---"
  if ($response.fundamental_sources -and $response.fundamental_sources.Count -gt 0) {
    $response.fundamental_sources | ForEach-Object {
      Write-Host ("- {0}" -f $_.title)
      Write-Host ("  {0}" -f $_.url)
    }
  } else {
    Write-Host "(no sources returned)"
  }

  Write-Host ""
  Write-Host "--- Result ---"
  if ($response.openai.web_search_used -eq $true -and $f.bias -and $f.freshness) {
    Write-Host "FUNDAMENTAL WEB SEARCH PATH: PASS" -ForegroundColor Green
  } else {
    Write-Host "FUNDAMENTAL WEB SEARCH PATH: CHECK" -ForegroundColor Yellow
  }

} catch {
  Write-Host ""
  Write-Host "HTTP/API: FAILED" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  if ($_.ErrorDetails.Message) {
    Write-Host $_.ErrorDetails.Message
  }
  exit 1
}