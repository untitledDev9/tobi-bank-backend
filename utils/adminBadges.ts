import Chat from '../models/Chat';
import User from '../models/User';
import Account from '../models/Account';
import Transaction from '../models/Transaction';

export interface AdminBadges {
  chats: { unread: number; conversations: number };
  accounts: { total: number; by_user: Record<string, number> };
}

// Counters for the admin panel's badges. An account is "new" to the admin when it registered
// itself and has not been opened yet, and for every transfer or withdrawal its owner started
// since an admin last opened it.
export const getAdminBadges = async (): Promise<AdminBadges> => {
  const [chatTotals, customers] = await Promise.all([
    Chat.aggregate([
      { $match: { status: { $ne: 'closed' }, admin_unread: { $gt: 0 } } },
      { $group: { _id: null, unread: { $sum: '$admin_unread' }, conversations: { $sum: 1 } } },
    ]),
    User.find({ role: 'customer' }).select('created_at created_by_admin admin_seen_at').lean(),
  ]);

  const seenAt = new Map<string, number>();
  const byUser: Record<string, number> = {};
  for (const c of customers) {
    const id = String(c._id);
    seenAt.set(id, new Date(c.admin_seen_at ?? c.created_at).getTime());
    if (!c.admin_seen_at && !c.created_by_admin) byUser[id] = 1;
  }

  if (customers.length > 0) {
    const accounts = await Account.find({ user_id: { $in: customers.map((c) => c._id) } })
      .select('user_id')
      .lean();
    const ownerOf = new Map(accounts.map((a) => [String(a._id), String(a.user_id)]));

    const activity = await Transaction.find({
      kind: { $in: ['transfer', 'withdrawal'] },
      type: 'debit',
      account_id: { $in: accounts.map((a) => a._id) },
      created_at: { $gt: new Date(Math.min(...seenAt.values())) },
    })
      .select('account_id created_at')
      .lean();

    for (const t of activity) {
      const owner = ownerOf.get(String(t.account_id));
      if (owner && t.created_at.getTime() > (seenAt.get(owner) ?? 0)) {
        byUser[owner] = (byUser[owner] ?? 0) + 1;
      }
    }
  }

  return {
    chats: { unread: chatTotals[0]?.unread ?? 0, conversations: chatTotals[0]?.conversations ?? 0 },
    accounts: { total: Object.values(byUser).reduce((sum, n) => sum + n, 0), by_user: byUser },
  };
};
