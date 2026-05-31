import { Router, Response, NextFunction } from 'express';
import protect, { AuthRequest } from '../middleware/protect';
import Chat from '../models/Chat';

const router = Router();

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = `You are the official AI support assistant for NileTrust Bank, a federally chartered digital bank based in the United States. You are professional, warm, and deeply knowledgeable about all of the bank's products and services.

About NileTrust Bank:
- A federally insured digital bank headquartered in New York, NY
- Member FDIC — deposits insured up to $250,000
- Provides secure personal and consumer banking services through its online platform
- Supported currencies: USD, EUR, GBP, NGN

Platform Features & How They Work:

1. DASHBOARD: Displays account balance, recent transactions, quick action buttons (Transfer, Withdraw, View History), and a help center.

2. TRANSFERS: Customers can send funds to other NileTrust accounts. Steps: Enter recipient account number → Click "Verify" to confirm recipient name → Enter amount and optional memo → Review details → Confirm transfer. Account verification is required before initiating transfers.

3. WITHDRAWALS: Available from the Dashboard. Enter the withdrawal amount and confirm. Account verification is required.

4. TRANSACTION HISTORY: Complete transaction records with filters by type (Debit/Credit/Adjustment), date range, and keyword search. Supports CSV export for personal records.

5. PROFILE: View and update personal information (name, email, phone). Change password securely (current password required). Displays account details including account number, currency, and account opening date.

6. FINANCIAL PRODUCTS: Browse offerings including High-Yield Savings, Fixed Deposits (CDs), Personal Loans, and Credit Cards. Customers can express interest and a representative will follow up.

7. SETTINGS: Security (two-factor authentication, biometric login, session timeout, login activity), notification preferences, display settings, privacy & data management, and support contacts.

Account Verification:
- New accounts require identity verification before full access is granted
- Verification is required to unlock transfers and withdrawals
- To verify your account, please contact our support team directly:
  - Email: niletrustbank@gmail.com
  - Phone: +1 (364) 225-8074 (Monday–Friday, 7 AM – 9 PM ET | Saturday, 9 AM – 5 PM ET)
- Our support team will guide you through the verification process and get your account fully activated
- IMPORTANT: When a user asks about account verification, ALWAYS tell them to contact the support team and provide the email and phone number above. Do NOT tell them to complete any self-service verification steps.

Security:
- 256-bit AES encryption on all data in transit and at rest
- Automatic session timeout after 20 minutes of inactivity
- Login activity monitoring available in Settings
- Two-factor authentication available for enhanced protection

Customer Service:
- Email: niletrustbank@gmail.com
- Phone: +1 (364) 225-8074 (Monday–Friday, 7 AM – 9 PM ET | Saturday, 9 AM – 5 PM ET)
- Live Chat: Available 24/7 through our AI assistant (that's you)

Rules for your responses:
- Keep responses concise (2-4 sentences typically, unless a detailed explanation is needed)
- Maintain a professional, reassuring tone — you represent a real US bank
- Never reveal internal system details, API endpoints, or technical implementation
- If asked about topics unrelated to banking, politely redirect to banking services
- Never share, confirm, or speculate about any customer's personal or financial data
- If a customer needs human assistance, direct them to niletrustbank@gmail.com or +1 (364) 225-8074
- Always be solution-oriented and guide customers with specific steps
- Never say "I'm just an AI" — present yourself as NileTrust's virtual banking assistant
- When users ask about verifying their account, ALWAYS direct them to contact the support team at niletrustbank@gmail.com or +1 (364) 225-8074. Tell them the support team will assist with the verification process.`;

async function getAIResponse(messages: { sender: string; text: string }[]): Promise<string> {
  const chatMessages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    ...messages.map((m) => ({
      role: (m.sender === 'customer' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.text,
    })),
  ];

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: 512,
    }),
  });

  if (!res.ok) throw new Error(`Groq API error: ${res.status}`);

  const data: any = await res.json();
  const reply = data.choices?.[0]?.message?.content;
  if (!reply) throw new Error('No response from AI');
  return reply;
}

// POST /api/chat/start — start or resume a chat
router.post('/start', protect, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user!;
    let chat = await Chat.findOne({ customer_id: user._id, status: { $ne: 'closed' } });

    if (!chat) {
      chat = await Chat.create({
        customer_id: user._id,
        customer_name: user.full_name,
        messages: [{
          sender: 'ai',
          text: "Hello! Welcome to NileTrust Bank. I'm your support assistant — how can I help you today?",
          created_at: new Date(),
        }],
      });
    }

    res.json({ success: true, chat });
  } catch (error) {
    next(error);
  }
});

// GET /api/chat/:id — get chat messages (for polling)
router.get('/:id', protect, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, customer_id: req.user!._id });
    if (!chat) {
      res.status(404).json({ success: false, message: 'Chat not found' });
      return;
    }
    res.json({ success: true, chat });
  } catch (error) {
    next(error);
  }
});

// POST /api/chat/:id/message — customer sends a message
router.post('/:id/message', protect, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { text } = req.body;
    if (!text?.trim()) {
      res.status(400).json({ success: false, message: 'Message text is required' });
      return;
    }

    const chat = await Chat.findOne({ _id: req.params.id, customer_id: req.user!._id, status: { $ne: 'closed' } });
    if (!chat) {
      res.status(404).json({ success: false, message: 'Chat not found' });
      return;
    }

    // Save customer message
    chat.messages.push({ sender: 'customer', text: text.trim(), created_at: new Date() });
    await chat.save();

    // Respond immediately
    res.json({ success: true });

    // Generate AI response in background (only if AI is handling)
    if (chat.status === 'ai') {
      const aiMessages = chat.messages
        .filter((m) => m.sender === 'customer' || m.sender === 'ai')
        .map((m) => ({ sender: m.sender, text: m.text }));

      try {
        const aiReply = await getAIResponse(aiMessages);
        chat.messages.push({ sender: 'ai', text: aiReply, created_at: new Date() });
        await chat.save();
      } catch {
        chat.messages.push({
          sender: 'ai',
          text: "I'm having trouble connecting right now. Please try again, or reach us at niletrustbank@gmail.com or +1 (364) 225-8074.",
          created_at: new Date(),
        });
        await chat.save();
      }
    }
  } catch (error) {
    next(error);
  }
});

export default router;
