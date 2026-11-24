import {
  CHAT_LIMITS,
  type ChatMessageDto,
  MESS_ORDER_STATUS_TEXT,
  OWNER_QUICK_REPLIES,
  type OrderChatDto,
  STUDENT_QUICK_REPLIES,
  chatTextProblem,
  formatMobile,
} from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { ArrowUp, Bell, Cross, Phone, PhotoIcon } from '../../shared/ui/icons';
import { rupees, shrinkPhoto } from '../restaurant/shared';
import { useAccountAlerts } from './alerts';
import { useLive, usePushWhileOpen } from './live';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dayLabel = (iso: string) => {
  const d = day(iso);
  const today = day(new Date().toISOString());
  const yesterday = day(new Date(Date.now() - 86_400_000).toISOString());
  if (d === today) return 'Today';
  if (d === yesterday) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
};

/** A private chat photo: loaded with the sign-in token, kept for the session. */
function ChatPhoto({
  orderId,
  file,
  onOpen,
}: { orderId: string; file: string; onOpen: (src: string) => void }) {
  const q = useQuery({
    queryKey: ['chat-photo', orderId, file],
    queryFn: () => api.chatPhoto(orderId, file),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60_000,
  });
  if (q.isError) return <span className="block p-3 text-[13px] text-ink2">Photo unavailable</span>;
  if (!q.data) return <span className="block w-[220px] h-[160px] animate-pulse bg-sunk rounded-lg" />;
  return (
    <button
      type="button"
      onClick={() => onOpen(q.data!)}
      className="block p-0 border-0 bg-transparent cursor-zoom-in"
    >
      <img src={q.data} alt="Sent" className="block max-w-[240px] max-h-[300px] rounded-lg object-cover" />
    </button>
  );
}

function Ticks({ read }: { read: boolean }) {
  return (
    <span aria-label={read ? 'Read' : 'Sent'} className={read ? 'text-[#53bdeb]' : 'opacity-70'}>
      {read ? '✓✓' : '✓'}
    </span>
  );
}

function Bubble({
  m,
  mine,
  read,
  orderId,
  onOpenPhoto,
  theirName,
}: {
  m: ChatMessageDto;
  mine: boolean;
  read: boolean;
  orderId: string;
  onOpenPhoto: (src: string) => void;
  theirName: string;
}) {
  if (m.sender === 'system')
    return (
      <div className="self-center max-w-[85%] my-1 rounded-lg bg-sunk px-3 py-1.5 text-center text-[12.5px] text-ink2">
        {m.body} · {time(m.createdAt)}
      </div>
    );
  return (
    <div className={`flex flex-col max-w-[82%] ${mine ? 'self-end items-end' : 'self-start items-start'}`}>
      <div
        className={`rounded-2xl px-3 py-2 text-[15px] leading-snug whitespace-pre-wrap break-words ${
          mine
            ? 'bg-teal text-white rounded-br-md'
            : 'bg-surface text-ink rounded-bl-md [box-shadow:inset_0_0_0_1px_var(--line)]'
        }`}
      >
        {!mine && <span className="sr-only">{theirName}: </span>}
        {m.photo && <ChatPhoto orderId={orderId} file={m.photo} onOpen={onOpenPhoto} />}
        {m.body && <span className={m.photo ? 'block mt-1.5' : ''}>{m.body}</span>}
        <span
          className={`ml-2 inline-flex items-center gap-1 align-bottom text-[11px] tabular-nums ${mine ? 'text-white/80' : 'text-ink2'}`}
        >
          {time(m.createdAt)}
          {mine && <Ticks read={read} />}
        </span>
      </div>
    </div>
  );
}

/** "Turn on notifications" inside the chat, for whoever hasn't yet on this device. */
function AlertsNudge({ who }: { who: 'student' | 'owner' }) {
  const a = useAccountAlerts();
  if (a.on || !a.configured || a.support === 'unsupported') return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-mist/40 px-4 py-2 text-[13.5px] text-ink">
      <Bell size={16} />
      <span className="flex-1 min-w-[160px]">
        {a.support === 'ios-install'
          ? 'On iPhone, add this site to your Home Screen to get notifications.'
          : a.support === 'blocked'
            ? 'Notifications are blocked for this site in your browser settings.'
            : who === 'owner'
              ? 'Hear new orders and messages even when this page is closed.'
              : 'Get a notification when the restaurant replies.'}
      </span>
      {a.support === 'ok' && (
        <Button size="sm" variant="brand" disabled={a.busy} onClick={() => void a.enable()}>
          {a.busy ? 'Turning on…' : 'Turn on'}
        </Button>
      )}
      {a.error && <span className="basis-full text-blush-text">{a.error}</span>}
    </div>
  );
}

type Panel = null | 'menu' | 'report' | 'clear' | 'block';

/**
 * One order's chat, like a messaging app. Students and restaurant owners write (text, photos,
 * quick replies) and see ✓ sent / ✓✓ read; the header has the order, a Call button and a menu
 * (clear chat for yourself, block or unblock the student, report). Admins read everything and can
 * clear a chat for everyone, but don't write.
 */
export function OrderChat({
  orderId,
  onClose,
  admin = false,
  asOwner = false,
}: {
  orderId: string;
  onClose: () => void;
  admin?: boolean;
  /** Opened from the restaurant's dashboard: answer as the restaurant. */
  asOwner?: boolean;
}) {
  const side = asOwner ? ('owner' as const) : undefined;
  const qc = useQueryClient();
  const key = ['chat', orderId, admin, asOwner];
  const [live, setLive] = useState(false);
  const q = useQuery({
    queryKey: key,
    queryFn: () => (admin ? api.adminOrderChat(orderId) : api.chat(orderId, side)),
    refetchInterval: live ? 25_000 : 4_000,
    refetchIntervalInBackground: false,
  });
  const chat = q.data;
  const connected = useLive(chat?.order.topic, () => void qc.invalidateQueries({ queryKey: key }));
  useEffect(() => setLive(connected), [connected]);
  usePushWhileOpen(() => void qc.invalidateQueries({ queryKey: key }));

  const [text, setText] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refreshLists = () => {
    void qc.invalidateQueries({ queryKey: ['my-mess-orders'] });
    void qc.invalidateQueries({ queryKey: ['owner-orders'] });
    void qc.invalidateQueries({ queryKey: ['owned-messes'] });
  };

  // Seen: mark read whenever new messages from the other side arrive while the chat is open.
  const unread = chat?.order.unread ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the unread count changes, not on every render
  useEffect(() => {
    if (admin || unread === 0 || document.visibilityState !== 'visible') return;
    void api.chatRead(orderId, side).then(refreshLists, () => {});
  }, [unread, admin, orderId]);

  // Stay at the bottom as messages come in (like any chat).
  const count = chat?.messages.length ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll again whenever a message is added
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (zoom) setZoom(null);
      else if (panel) setPanel(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, panel, zoom]);

  // The background refresh may already have brought this message in: never show it twice.
  const append = (m: ChatMessageDto) =>
    qc.setQueryData<OrderChatDto>(key, (old) =>
      old && !old.messages.some((x) => x.id === m.id) ? { ...old, messages: [...old.messages, m] } : old,
    );
  // Clear the box only if it still holds what was sent (the next message may already be typed).
  const clearIfSent = (body: string) => setText((t) => (t.trim() === body.trim() ? '' : t));

  const send = useMutation({
    mutationFn: (m: { body: string; photo?: string }) =>
      api.chatSend(orderId, { body: m.body, photo: m.photo ?? '' }, side),
    onSuccess: (m) => {
      append(m);
      clearIfSent(m.body);
      refreshLists();
      inputRef.current?.focus();
    },
  });
  const photo = useMutation({
    mutationFn: async (file: File) => {
      const { photo: name } = await api.chatUploadPhoto(orderId, await shrinkPhoto(file, 1280), side);
      return api.chatSend(orderId, { body: text.trim(), photo: name }, side);
    },
    onSuccess: (m) => {
      append(m);
      clearIfSent(m.body);
      refreshLists();
    },
  });
  const act = useMutation({
    mutationFn: async (what: 'clear' | 'block' | 'unblock' | 'report' | 'admin-clear') => {
      if (what === 'clear') await api.chatClear(orderId, side);
      if (what === 'block') await api.chatBlock(orderId, reason.trim());
      if (what === 'unblock') await api.chatUnblock(orderId);
      if (what === 'report') await api.chatReport(orderId, reason.trim(), side);
      if (what === 'admin-clear') await api.adminClearChat(orderId);
      return what;
    },
    onSuccess: (what) => {
      setPanel(null);
      setReason('');
      setNotice(
        {
          clear: 'Chat cleared for you. The restaurant still has its copy.',
          block: 'Blocked. They can no longer order from you or message you.',
          unblock: 'Unblocked.',
          report: 'Reported. The Scholars Stack team will look at this chat.',
          'admin-clear': 'Every message in this chat was deleted for everyone.',
        }[what],
      );
      void qc.invalidateQueries({ queryKey: key });
      refreshLists();
    },
  });

  const role = chat?.role ?? 'student';
  const mine = (m: ChatMessageDto) => (admin ? m.sender === 'owner' : m.sender === role);
  const problem = text.trim() ? chatTextProblem(text) : null;
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || problem || send.isPending) return;
    send.mutate({ body });
  };
  const replies = role === 'owner' ? OWNER_QUICK_REPLIES : STUDENT_QUICK_REPLIES;
  const other = chat ? (role === 'owner' ? chat.order.name : chat.order.messName) : '';
  const busy = send.isPending || photo.isPending;
  const sendError = send.error ?? photo.error;

  // At the page root: a parent with a transform (page animations) would otherwise trap the overlay.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end" role="presentation">
      <button
        type="button"
        aria-label="Close chat"
        onClick={onClose}
        className="absolute inset-0 bg-black/35 border-0 cursor-default hidden md:block"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={chat ? `Chat about order ${chat.order.code}` : 'Chat'}
        className="relative flex flex-col w-full md:w-[460px] h-full bg-bg md:border-l md:border-line shadow-2xl"
      >
        {/* Header: who, which order, Call, menu */}
        <header className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5 pt-[max(10px,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="grid place-items-center w-10 h-10 rounded-full border-0 bg-transparent text-ink hover:bg-sunk cursor-pointer"
          >
            <Cross size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="m-0 truncate text-[16px] font-bold text-ink">
              {admin && chat ? `${chat.order.messName} ⇄ ${chat.order.name}` : other || 'Chat'}
            </p>
            {chat && (
              <p className="m-0 truncate text-[12.5px] text-ink2">
                Order {chat.order.code} · {MESS_ORDER_STATUS_TEXT[chat.order.status]}
              </p>
            )}
          </div>
          {chat?.callPhone && (
            <a
              href={`tel:${chat.callPhone}`}
              aria-label={`Call ${other}`}
              title="Call (for anything urgent)"
              className="grid place-items-center w-10 h-10 rounded-full text-ink no-underline hover:bg-sunk"
            >
              <Phone size={19} />
            </a>
          )}
          {chat && (
            <button
              type="button"
              aria-label="More"
              aria-expanded={panel === 'menu'}
              onClick={() => setPanel(panel ? null : 'menu')}
              className="grid place-items-center w-10 h-10 rounded-full border-0 bg-transparent text-ink text-[22px] leading-none hover:bg-sunk cursor-pointer"
            >
              ⋮
            </button>
          )}
        </header>

        {panel === 'menu' && chat && (
          <div
            role="menu"
            className="absolute right-3 top-[60px] z-10 w-[240px] rounded-xl bg-surface py-1.5 shadow-xl [box-shadow:0_12px_32px_-8px_rgba(0,0,0,.35),inset_0_0_0_1px_var(--line)]"
          >
            {[
              ...(admin
                ? [['admin-clear', 'Clear for everyone', 'text-blush-text'] as const]
                : [
                    ['clear', 'Clear chat', ''] as const,
                    ...(role === 'owner'
                      ? [
                          chat.blocked
                            ? (['unblock', 'Unblock student', ''] as const)
                            : (['block', 'Block student', 'text-blush-text'] as const),
                        ]
                      : []),
                    ['report', 'Report', 'text-blush-text'] as const,
                  ]),
            ].map(([k, label, tone]) => (
              <button
                key={k}
                type="button"
                role="menuitem"
                onClick={() =>
                  k === 'unblock'
                    ? act.mutate('unblock')
                    : setPanel(k === 'admin-clear' ? 'clear' : (k as Panel))
                }
                className={`block w-full text-left px-4 py-2.5 text-[15px] border-0 bg-transparent hover:bg-sunk cursor-pointer ${tone || 'text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {!admin && chat && <AlertsNudge who={role === 'owner' ? 'owner' : 'student'} />}

        {/* The order, pinned at the top like a shared item */}
        {chat && (
          <details className="border-b border-line bg-surface/60 px-4 py-2 text-[13.5px] text-ink">
            <summary className="cursor-pointer text-ink2">
              {chat.order.lines.reduce((n, l) => n + l.qty, 0)} items · {rupees(chat.order.total)} ·{' '}
              {chat.order.mode === 'delivery' ? 'Delivery' : 'Pickup'}
            </summary>
            <ul className="m-0 mt-1.5 p-0 list-none flex flex-col gap-0.5">
              {chat.order.lines.map((l) => (
                <li key={`${l.name}${l.detail}`}>
                  {l.qty} × {l.detail ? l.detail.split(':')[0] : l.name}
                </li>
              ))}
              {chat.order.mode === 'delivery' && <li className="text-ink2">To {chat.order.address}</li>}
              {role !== 'student' && (
                <li className="text-ink2">
                  {chat.order.name} · {formatMobile(chat.order.phone)}
                </li>
              )}
              {chat.order.note && <li className="text-ink2">“{chat.order.note}”</li>}
            </ul>
          </details>
        )}

        {/* Messages */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-3 py-3 bg-[color-mix(in_oklab,var(--sunk)_55%,var(--bg))]"
          aria-live="polite"
        >
          {q.isLoading ? (
            <Skeleton className="h-40" />
          ) : q.isError || !chat ? (
            <ErrorState
              title="Couldn't open the chat"
              message={friendly(q.error)}
              onRetry={() => q.refetch()}
            />
          ) : (
            <ol className="m-0 p-0 list-none flex flex-col gap-1.5">
              {chat.clearedAt && (
                <li className="self-center text-[12px] text-ink2 py-1">You cleared earlier messages</li>
              )}
              {!chat.messages.length && (
                <li className="self-center max-w-[300px] text-center text-[14px] text-ink2 py-8">
                  {admin
                    ? 'No messages in this chat.'
                    : role === 'owner'
                      ? `Messages with ${chat.order.name} about this order show here.`
                      : 'Ask the restaurant anything about this order. They usually reply here.'}
                </li>
              )}
              {chat.messages.map((m, i) => {
                const prev = chat.messages[i - 1];
                return (
                  <li key={m.id} className="flex flex-col">
                    {(!prev || day(prev.createdAt) !== day(m.createdAt)) && (
                      <span className="self-center my-1 rounded-full bg-surface px-3 py-0.5 text-[12px] text-ink2 [box-shadow:inset_0_0_0_1px_var(--line)]">
                        {dayLabel(m.createdAt)}
                      </span>
                    )}
                    <Bubble
                      m={m}
                      mine={mine(m)}
                      read={!!chat.otherReadAt && chat.otherReadAt >= m.createdAt}
                      orderId={orderId}
                      onOpenPhoto={setZoom}
                      theirName={other}
                    />
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {notice && (
          <p
            role="status"
            className="m-0 border-t border-line bg-mist/50 px-4 py-2 text-[13.5px] text-ink flex gap-2"
          >
            <span className="flex-1">{notice}</span>
            <button
              type="button"
              onClick={() => setNotice('')}
              className="border-0 bg-transparent text-ink2 cursor-pointer"
            >
              OK
            </button>
          </p>
        )}

        {/* Confirmations for the menu's actions */}
        {(panel === 'clear' || panel === 'block' || panel === 'report') && chat && (
          <div className="border-t border-line bg-surface px-4 py-3 flex flex-col gap-2.5">
            <p className="m-0 text-[14.5px] text-ink">
              {panel === 'clear'
                ? admin
                  ? 'Delete every message and photo in this chat for both sides? This cannot be undone.'
                  : 'Clear this chat for you? The other side keeps their copy.'
                : panel === 'block'
                  ? `Block ${chat.order.name}? They won't be able to order from you or message you until you unblock them.`
                  : 'What went wrong? The Scholars Stack team reads every report and can see this chat.'}
            </p>
            {panel !== 'clear' && (
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={panel === 'block' ? 200 : 500}
                rows={2}
                placeholder={
                  panel === 'block'
                    ? 'Reason (only you and the admin see it)'
                    : 'e.g. rude messages, fake order'
                }
                aria-label="Reason"
                className="rounded-lg border-[1.5px] border-line bg-bg px-3 py-2 text-[14px] outline-none focus:border-teal resize-none"
              />
            )}
            {act.error && <p className="m-0 text-[13px] text-blush-text">{friendly(act.error)}</p>}
            <div className="flex gap-2">
              <Button
                variant="ink"
                size="sm"
                disabled={act.isPending || (panel === 'report' && reason.trim().length < 3)}
                onClick={() =>
                  act.mutate(
                    panel === 'clear'
                      ? admin
                        ? 'admin-clear'
                        : 'clear'
                      : panel === 'block'
                        ? 'block'
                        : 'report',
                  )
                }
              >
                {panel === 'clear'
                  ? admin
                    ? 'Delete for everyone'
                    : 'Clear chat'
                  : panel === 'block'
                    ? 'Block'
                    : 'Send report'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Composer */}
        {chat && !admin && (
          <footer className="border-t border-line bg-surface px-3 pt-2 pb-[max(10px,env(safe-area-inset-bottom))]">
            {!chat.canSend ? (
              <p className="m-0 py-2 text-center text-[14px] text-ink2">
                {chat.closedReason}
                {chat.blocked && role === 'owner' && (
                  <>
                    {' '}
                    <button
                      type="button"
                      onClick={() => act.mutate('unblock')}
                      className="border-0 bg-transparent p-0 font-semibold text-teal-text underline cursor-pointer"
                    >
                      Unblock
                    </button>
                  </>
                )}
              </p>
            ) : (
              <>
                <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1" aria-label="Quick replies">
                  {replies.map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={busy}
                      onClick={() => send.mutate({ body: r })}
                      className="flex-none h-8 rounded-full border border-line bg-bg px-3 text-[13px] font-semibold text-ink2 hover:text-ink hover:border-ink2 cursor-pointer whitespace-nowrap"
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <form onSubmit={submit} className="flex items-end gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    aria-label="Send a photo"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) photo.mutate(f);
                    }}
                  />
                  <button
                    type="button"
                    aria-label="Send a photo"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                    className="grid place-items-center w-11 h-11 shrink-0 rounded-full border-0 bg-transparent text-ink2 hover:text-ink hover:bg-sunk cursor-pointer"
                  >
                    <PhotoIcon size={21} />
                  </button>
                  <textarea
                    ref={inputRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        submit();
                      }
                    }}
                    rows={1}
                    maxLength={CHAT_LIMITS.bodyMax}
                    placeholder="Message"
                    aria-label="Message"
                    aria-invalid={!!problem}
                    className="flex-1 min-h-11 max-h-32 rounded-3xl border-[1.5px] border-line bg-bg px-4 py-2.5 text-[15px] leading-snug outline-none focus:border-teal resize-none [field-sizing:content]"
                  />
                  <button
                    type="submit"
                    aria-label="Send"
                    disabled={!text.trim() || !!problem || busy}
                    className="grid place-items-center w-11 h-11 shrink-0 rounded-full border-0 bg-teal text-white disabled:opacity-40 cursor-pointer"
                  >
                    <ArrowUp size={20} />
                  </button>
                </form>
                {(problem || sendError) && (
                  <p role="alert" className="m-0 mt-1.5 px-2 text-[13px] text-blush-text">
                    {problem ?? friendly(sendError)}
                  </p>
                )}
                {photo.isPending && <p className="m-0 mt-1.5 px-2 text-[13px] text-ink2">Sending photo…</p>}
              </>
            )}
          </footer>
        )}

        {zoom && (
          <button
            type="button"
            onClick={() => setZoom(null)}
            aria-label="Close photo"
            className="absolute inset-0 z-20 grid place-items-center bg-black/85 border-0 cursor-zoom-out"
          >
            <img src={zoom} alt="Sent in the chat" className="max-w-[95%] max-h-[90%] object-contain" />
          </button>
        )}
      </section>
    </div>,
    document.body,
  );
}

/** A "Chat" button with the unread count, for lists and tickets. */
export function ChatButton({
  unread,
  onClick,
  label = 'Chat',
  className = '',
}: {
  unread: number;
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={unread ? `${label}, ${unread} unread` : label}
      className={`relative inline-flex items-center justify-center gap-2 h-10 px-4 rounded-full border-[1.5px] border-line bg-surface text-[14px] font-semibold text-ink hover:border-ink2 cursor-pointer ${className}`}
    >
      💬 {label}
      {unread > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] grid place-items-center rounded-full bg-[#25d366] px-1.5 text-[12px] font-bold text-white tabular-nums">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}
