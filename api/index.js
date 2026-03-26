const { MongoClient } = require('mongodb');

let cachedClient = null;
async function getDb() {
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGODB_URI);
    await cachedClient.connect();
  }
  return cachedClient.db('flowagent');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const db = await getDb();
      const leads = await db.collection('leads').find({}).sort({ date: -1 }).limit(500).toArray();
      return res.status(200).json({ leads });
    } catch (err) {
      return res.status(200).json({ leads: [], error: err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { messages, systemPrompt, ownerEmail, clientName, leadName, leadPhone, leadEmail, conversation, isLead } = req.body;

    if (isLead) {
      try {
        const db = await getDb();
        const firstMsg = (conversation || '').split('\n').find(l => l.startsWith('Visitor:'))?.replace('Visitor: ', '') || '';
        await db.collection('leads').insertOne({
          name: leadName || 'Unknown',
          phone: leadPhone || '',
          email: leadEmail || '',
          message: firstMsg,
          conversation: conversation || '',
          status: 'new',
          source: 'Chatbot',
          notes: '',
          client: clientName || '',
          date: new Date().toISOString(),
        });
      } catch (dbErr) {
        console.error('MongoDB error:', dbErr.message);
      }

      const chatLines = (conversation || '').split('\n').filter(Boolean);
      const chatRows = chatLines.map(line => {
        const isVisitor = line.startsWith('Visitor:');
        const text = line.replace(/^(Visitor:|Bot:)\s*/, '');
        return '<tr style="background:' + (isVisitor ? '#f0f7ff' : '#fff') + '"><td style="padding:8px 12px;font-weight:600;color:' + (isVisitor ? '#2563ff' : '#555') + ';white-space:nowrap;vertical-align:top;">' + (isVisitor ? 'Visitor' : 'Bot') + '</td><td style="padding:8px 12px;color:#333;">' + text + '</td></tr>';
      }).join('') || '<tr><td colspan="2" style="padding:8px 12px;color:#999;">No conversation</td></tr>';

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
        body: JSON.stringify({
          from: 'FlowAgent AI <onboarding@resend.dev>',
          to: [ownerEmail],
          subject: 'New lead from ' + clientName + ' — ' + leadName,
          html: '<div style="font-family:sans-serif;max-width:580px;margin:0 auto;"><div style="background:#080808;padding:20px 24px;"><h1 style="color:#2563ff;font-size:20px;margin:0;">FlowAgent AI</h1><p style="color:#888;font-size:12px;margin:4px 0 0;">New lead on ' + clientName + '</p></div><div style="padding:24px;background:#f9f9f9;border-left:4px solid #2563ff;"><table style="border-collapse:collapse;width:100%;"><tr><td style="padding:6px 0;color:#555;width:80px;">Name</td><td style="padding:6px 0;font-weight:600;">' + (leadName||'Not provided') + '</td></tr><tr><td style="padding:6px 0;color:#555;">Phone</td><td style="padding:6px 0;font-weight:600;">' + (leadPhone||'Not provided') + '</td></tr><tr><td style="padding:6px 0;color:#555;">Email</td><td style="padding:6px 0;font-weight:600;">' + (leadEmail||'Not provided') + '</td></tr></table></div><div style="padding:24px;"><table style="border-collapse:collapse;width:100%;border:1px solid #eee;">' + chatRows + '</table></div><div style="padding:16px 24px;background:#f5f5f5;text-align:center;"><p style="color:#999;font-size:11px;margin:0;">Powered by FlowAgent AI</p></div></div>',
        }),
      });

      return res.status(200).json({ sent: true });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 400,
        system: systemPrompt,
        messages,
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.status(200).json({ reply: data.content[0].text });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
