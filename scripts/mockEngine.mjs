// محرّك اختبار محلي متوافق مع OpenAI (يحاكي Ollama) — للتحقق من المسار الكامل فقط.
import http from 'node:http';

const yaml = `meta:
  title: حصار بحري تجريبي
  map: world_live
timeline:
  - at: "0s"
    caption: { text: "بداية الحصار البحري" }
  - at: "1s"
    sound: alert_ping
`;

http
  .createServer((req, res) => {
    if (req.url.endsWith('/models')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ data: [{ id: 'qwen2.5:7b-instruct' }] }));
    }
    if (req.url.endsWith('/chat/completions')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        process.stderr.write(`ENGINE model=${parsed.model} stream=${parsed.stream}\n`);
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'إليك السيناريو:\n```yaml\n' + yaml + '```\n' } }]
          })
        );
      });
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  })
  .listen(11434, '0.0.0.0', () => console.log('mock engine on :11434'));
