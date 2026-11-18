const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const app = express();
app.use(cors());
app.use(express.json());
const anthropic = new Anthropic({
apiKey: process.env.ANTHROPIC
API
_
_
KEY,
});
// 这是唯一的一个接口：前端把聊天记录发过来，这里转手问Claude，再把回答传回去
app.post('/api/chat'
, async (req, res) => {
try {
const { messages } = req.body;
const response = await anthropic.messages.create({
model: 'claude-sonnet-5'
,
max
_
tokens: 1024,
messages: messages,
});
res.json({ reply: response.content[0].text });
} catch (err) {
console.error(err);
res.status(500).json({ error: '出错了，请稍后再试' });
}
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`服务器已启动，端口 ${PORT}`);
});
