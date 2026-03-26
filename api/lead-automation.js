// api/lead-automation.js - READY FOR VERCEL
// Copy this entire file to your Vercel project at /api/lead-automation.js

import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';
import { MongoClient } from 'mongodb';

const client = new Anthropic();
const mongoUri = process.env.MONGODB_URI;
let mongoClient = null;

// Initialize MongoDB
async function getDatabase() {
    if (!mongoClient) {
          mongoClient = new MongoClient(mongoUri);
          await mongoClient.connect();
    }
    return mongoClient.db('flowagent');
}

// Email transporter
const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD,
    },
});

/**
 * WEBHOOK - Receives leads from your agentic AI
 */
export async function handleLeadCapture(req, res) {
    try {
          const { name, phone, email, businessType, message, source } = req.body;

      // Store raw lead
      const db = await getDatabase();
          const lead = {
                  id: Date.now().toString(),
                  name,
                  phone,
                  email,
                  businessType,
                  message,
                  source: source || 'web',
                  status: 'captured',
                  createdAt: new Date(),
                  score: 0,
                  qualificationRound: 0,
          };

      await db.collection('leads').insertOne(lead);

      // AI qualification
      const qualified = await qualifyLead(lead);

      // Route based on score
      if (qualified.score >= 70) {
              await routeHighQualityLead(qualified);
              await sendWelcomeEmail(qualified, 'growth');
              await triggerLeadSequence(qualified, 'growth');
      } else if (qualified.score >= 40) {
              await sendNurtureEmail(qualified);
              await triggerLeadSequence(qualified, 'nurture');
      } else {
              await sendAcknowledgementEmail(qualified);
      }

      // Log analytics
      await logAnalytic('lead_captured', { source, score: qualified.score });

      res.json({
              success: true,
              leadId: lead.id,
              qualificationScore: qualified.score,
              status: qualified.fitLevel,
              message: 'Lead captured and automated sequences triggered'
      });
    } catch (error) {
          console.error('Lead capture error:', error);
          res.status(500).json({ error: 'Failed to process lead', details: error.message });
    }
}

/**
 * AI-POWERED LEAD QUALIFICATION
 */
async function qualifyLead(lead) {
    const qualificationPrompt = `
    You are a lead qualification expert for FlowAgent AI (Melbourne AI automation for small businesses).

    Analyze this lead and score 0-100 based on fit and buying intent:

    Lead:
    - Name: ${lead.name}
    - Phone: ${lead.phone}
    - Email: ${lead.email}
    - Business Type: ${lead.businessType}
    - Message: ${lead.message}

    Score 0-100:
    - Target business type (tradies, salons, physios, cafes, photographers, dentists, wedding planners, dog groomers): +30
    - Clear pain point (leads, bookings, automation): +20
    - Ready to act (language like "want", "need", "looking"): +20
    - Complete contact info: +15
    - Engaged tone/clear intent: +15

    Respond ONLY as JSON:
    {
      "score": <0-100>,
        "reasoning": "<brief>",
          "fitLevel": "perfect|good|moderate|poor",
            "recommendedAction": "immediate|follow-up|nurture|pass"
            }
            `;

  const response = await client.messages.create({
        model: 'claude-opus-4-20250514',
        max_tokens: 300,
        messages: [{ role: 'user', content: qualificationPrompt }],
  });

  const qualData = JSON.parse(response.content[0].text);

  const db = await getDatabase();
    await db.collection('leads').updateOne(
      { id: lead.id },
      {
              $set: {
                        score: qualData.score,
                        fitLevel: qualData.fitLevel,
                        reasoning: qualData.reasoning,
                        status: qualData.recommendedAction,
                        qualifiedAt: new Date(),
              },
      }
        );

  return { ...lead, ...qualData, id: lead.id };
}

/**
 * EMAIL SEQUENCES
 */

async function sendWelcomeEmail(lead, tier) {
    const subject = `${lead.name}, Let's Automate Your Lead Generation 🚀`;
    const html = `
        <h2>Hi ${lead.name},</h2>
            <p>Thanks for reaching out to FlowAgent AI!</p>
                <p>We specialize in <strong>${lead.businessType}</strong> automation for Melbourne businesses.</p>
                    <p><strong>What we do:</strong></p>
                        <ul>
                              <li>✅ Capture leads 24/7 automatically</li>
                                    <li>✅ AI qualifies them instantly</li>
                                          <li>✅ Routes based on priority</li>
                                                <li>✅ Send personalized email sequences</li>
                                                      <li>✅ Track everything in real-time analytics</li>
                                                          </ul>
                                                              <p><strong>Growth Tier Pricing:</strong></p>
                                                                  <ul>
                                                                        <li>Setup: $799 (one-time)</li>
                                                                              <li>Monthly: $349</li>
                                                                                    <li>Multi-channel lead capture</li>
                                                                                          <li>Advanced analytics</li>
                                                                                                <li>API access</li>
                                                                                                      <li>Priority support</li>
                                                                                                          </ul>
                                                                                                              <p><a href="https://calendly.com/jmcsbusinessss">📅 Book a demo here</a></p>
                                                                                                                  <p>Joey<br>FlowAgent AI<br>Melbourne</p>
                                                                                                                    `;

  await emailTransporter.sendMail({
        from: process.env.EMAIL_USER,
        to: lead.email,
        subject,
        html,
  });

  const db = await getDatabase();
    await db.collection('emailSequence').insertOne({
          leadId: lead.id,
          type: 'welcome',
          sentAt: new Date(),
          status: 'sent',
    });
}

async function sendNurtureEmail(lead) {
    const subject = `${lead.name}, Free AI Consultation for ${lead.businessType}`;
    const html = `
        <h2>Hi ${lead.name},</h2>
            <p>Quick follow-up on your inquiry about lead automation.</p>
                <p>We're offering a <strong>free 30-minute consultation</strong> for businesses like yours in Melbourne.</p>
                    <p>In the call, we'll:</p>
                        <ul>
                              <li>✅ Analyze your current lead flow</li>
                                    <li>✅ Show you the exact bottlenecks</li>
                                          <li>✅ Demo how AI can fix it</li>
                                                <li>✅ Give you a custom cost & timeline</li>
                                                    </ul>
                                                        <p><strong>No obligation, no sales pitch.</strong></p>
                                                            <p><a href="https://calendly.com/jmcsbusinessss">📅 Claim your free slot (only 3 left this week)</a></p>
                                                                <p>Joey<br>FlowAgent AI</p>
                                                                  `;

  await emailTransporter.sendMail({
        from: process.env.EMAIL_USER,
        to: lead.email,
        subject,
        html,
  });

  const db = await getDatabase();
    await db.collection('emailSequence').insertOne({
          leadId: lead.id,
          type: 'nurture',
          sentAt: new Date(),
    });
}

async function sendAcknowledgementEmail(lead) {
    const subject = 'Thanks for Your Interest in FlowAgent AI';
    const html = `
        <h2>Hi ${lead.name},</h2>
            <p>Thanks for reaching out to FlowAgent AI!</p>
                <p>We appreciate your interest. We'll review your inquiry and get back to you within 24 hours.</p>
                    <p>Website: <a href="https://flow-agent.tiiny.site">flow-agent.tiiny.site</a></p>
                        <p>Cheers,<br>Joey & the FlowAgent Team</p>
                          `;

  await emailTransporter.sendMail({
        from: process.env.EMAIL_USER,
        to: lead.email,
        subject,
        html,
  });
}

/**
 * LEAD ROUTING
 */

async function routeHighQualityLead(lead) {
    const db = await getDatabase();
    await db.collection('tasks').insertOne({
          leadId: lead.id,
          type: 'immediate_followup',
          leadName: lead.name,
          leadEmail: lead.email,
          score: lead.score,
          createdAt: new Date(),
          status: 'pending',
          priority: 'high',
    });

  // Optional: Send Slack notification
  if (process.env.SLACK_WEBHOOK) {
        await fetch(process.env.SLACK_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                          text: `🔥 Hot Lead! ${lead.name} (${lead.businessType}) - Score: ${lead.score}/100\n📧 ${lead.email}\n📱 ${lead.phone}`,
                }),
        });
  }
}

async function triggerLeadSequence(lead, sequenceType) {
    const db = await getDatabase();

  const schedule = sequenceType === 'growth'
      ? [
        { delay: 1, email: 'demo_video' },
        { delay: 3, email: 'case_study' },
        { delay: 7, email: 'limited_offer' },
              ]
        : [
          { delay: 2, email: 'nurture_check' },
          { delay: 5, email: 'success_story' },
          { delay: 10, email: 'final_offer' },
                ];

  for (const item of schedule) {
        const scheduledDate = new Date();
        scheduledDate.setDate(scheduledDate.getDate() + item.delay);

      await db.collection('scheduledEmails').insertOne({
              leadId: lead.id,
              type: item.email,
              scheduledFor: scheduledDate,
              status: 'pending',
              createdAt: new Date(),
      });
  }
}

/**
 * ANALYTICS
 */

async function logAnalytic(eventType, data) {
    const db = await getDatabase();
    await db.collection('analytics').insertOne({
          event: eventType,
          data,
          timestamp: new Date(),
    });
}

export async function getAnalytics(req, res) {
    try {
          const db = await getDatabase();

      const totalLeads = await db.collection('leads').countDocuments();
          const qualifiedLeads = await db
            .collection('leads')
            .countDocuments({ score: { $gte: 70 } });
          const emailsSent = await db.collection('emailSequence').countDocuments();

      const avgScoreResult = await db
            .collection('leads')
            .aggregate([{ $group: { _id: null, avg: { $avg: '$score' } } }])
            .toArray();
          const avgScore = avgScoreResult[0]?.avg || 0;

      const conversionRate = totalLeads > 0 ? (qualifiedLeads / totalLeads) * 100 : 0;

      const recentLeads = await db
            .collection('leads')
            .find({})
            .sort({ createdAt: -1 })
            .limit(10)
            .toArray();

      res.json({
              success: true,
              summary: {
                        totalLeads,
                        qualifiedLeads,
                        emailsSent,
                        avgQualificationScore: Math.round(avgScore),
                        conversionRate: conversionRate.toFixed(1),
              },
              recentLeads: recentLeads.map((lead) => ({
                        id: lead.id,
                        name: lead.name,
                        businessType: lead.businessType,
                        score: lead.score,
                        status: lead.status,
                        createdAt: lead.createdAt,
              })),
      });
    } catch (error) {
          console.error('Analytics error:', error);
          res.status(500).json({ error: 'Failed to fetch analytics' });
    }
}

/**
 * VERCEL HANDLER
 */
export default async function handler(req, res) {
    const { action } = req.query;

  if (req.method === 'POST' && action === 'capture') {
        return handleLeadCapture(req, res);
  } else if (req.method === 'GET' && action === 'analytics') {
        return getAnalytics(req, res);
  } else if (req.method === 'GET') {
        // Health check
      return res.json({ status: 'ok', message: 'FlowAgent Growth Tier API is running' });
  } else {
        res.status(400).json({ error: 'Invalid action' });
  }
}
