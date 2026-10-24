import Chat from '../models/Chat';

// Admin chat list. The preview only needs the last message, so have Mongo slice it instead of
// loading every message of every open chat; the admin page polls this once a second.
const listActiveChats = async () => {
  const chats = await Chat.find({ status: { $ne: 'closed' } })
    .sort({ updated_at: -1 })
    .select({ customer_name: 1, status: 1, admin_id: 1, updated_at: 1, admin_unread: 1, messages: { $slice: -1 } })
    .lean();

  return chats.map((c) => ({
    _id: c._id,
    customer_name: c.customer_name,
    status: c.status,
    updated_at: c.updated_at,
    unread: c.admin_unread ?? 0,
    lastMessage: c.messages[c.messages.length - 1],
  }));
};

export default listActiveChats;
