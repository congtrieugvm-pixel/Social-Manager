'use client';
import { useMemo, useState } from 'react';
import { AppWindow, EyeOff, Play, Square, Layers } from 'lucide-react';
import { confirmDialog } from '@/app/_components/notify';
import type { dashboard } from '@/lib/browser-service';
import styles from './manager.module.css';

type Data = Awaited<ReturnType<typeof dashboard>>;
type Act = (route: string, body: unknown) => Promise<void>;
type Filter = 'active' | 'all';

const OPEN = ['starting', 'open', 'logged_in', 'unverified', 'needs_verification', 'wrong_account'];
const ACTIVE_JOB = ['queued', 'claimed', 'running'];
const statusLabel: Record<string, string> = { starting: 'Đang mở', open: 'Đã mở', needs_verification: 'Cần xác minh', unverified: 'Chưa xác minh', logged_in: 'Đã đăng nhập', wrong_account: 'Nhầm tài khoản', closed: 'Đã đóng', error: 'Có lỗi', interrupted: 'Bị gián đoạn', revoked: 'Đã thu hồi' };
const jobLabel: Record<string, string> = { open: 'Mở trình duyệt', close: 'Đóng', hide: 'Ẩn bài', post: 'Đăng video', preview: 'Xem trước video' };
const stateLabel: Record<string, string> = { queued: 'chờ luồng trống', claimed: 'máy đã nhận', running: 'đang chạy' };
const tone = (status: string) => status === 'logged_in' ? 'good' : ['needs_verification', 'wrong_account', 'error', 'interrupted'].includes(status) ? 'warn' : OPEN.includes(status) ? 'good' : 'neutral';

function hideProgress(result: string | null) {
  if (!result) return null;
  try { const r = JSON.parse(result) as { changed: number; skipped: number; message?: string }; return `${r.changed} đã ẩn · ${r.skipped} vốn riêng tư${r.message ? ` · ${r.message}` : ''}`; } catch { return null; }
}

/** Every browser window/profile with what it is doing, plus how many may run at once per machine. */
export default function WindowsPanel({ data, deviceId, busy, act }: { data: Data | undefined; deviceId: string; busy: boolean; act: Act }) {
  const [filter, setFilter] = useState<Filter>('active');
  const [selected, setSelected] = useState<number[]>([]);
  const online = (id: string) => !!data?.devices.some(d => d.id === id && !d.revoked && d.lastSeenAt >= data.now - 60);

  const rows = useMemo(() => {
    if (!data) return [];
    const names = new Map(data.windows.map(w => [w.accountId, w.username]));
    return data.profiles.filter(p => p.status !== 'revoked').map(p => {
      const jobs = data.jobs.filter(j => j.accountId === p.accountId);
      const active = jobs.find(j => ACTIVE_JOB.includes(j.state) && j.kind !== 'close' && !(j.kind === 'open' && j.state === 'running'));
      return { profile: p, username: names.get(p.accountId) ?? `#${p.accountId}`, device: data.devices.find(d => d.id === p.deviceId), active, pending: jobs.filter(j => ['queued', 'claimed'].includes(j.state)) };
    }).filter(r => filter === 'all' || OPEN.includes(r.profile.status) || r.active)
      .sort((a, b) => Number(OPEN.includes(b.profile.status)) - Number(OPEN.includes(a.profile.status)) || b.profile.updatedAt - a.profile.updatedAt);
  }, [data, filter]);

  const openCount = data?.profiles.filter(p => OPEN.includes(p.status)).length ?? 0;
  const queued = data?.jobs.filter(j => j.state === 'queued' && ['open', 'hide'].includes(j.kind)).length ?? 0;
  const picked = rows.filter(r => selected.includes(r.profile.accountId));

  /** Send one kind of job for these rows, grouped by the machine that holds each profile. */
  async function send(kind: 'open' | 'close' | 'hide', list: typeof rows) {
    const byDevice = new Map<string, number[]>();
    for (const r of list) {
      if (!online(r.profile.deviceId)) continue;
      byDevice.set(r.profile.deviceId, [...(byDevice.get(r.profile.deviceId) ?? []), r.profile.accountId]);
    }
    if (kind === 'close') for (const r of list) for (const j of r.pending) await act('jobs/cancel', { id: j.id });
    for (const [device, ids] of byDevice) for (let i = 0; i < ids.length; i += 20) await act('jobs', { kind, ids: ids.slice(i, i + 20), deviceId: device, autofill: true });
    setSelected([]);
  }
  async function closeAll() {
    const list = rows.filter(r => OPEN.includes(r.profile.status) || r.active);
    if (!list.length) return;
    if (await confirmDialog({ title: 'Đóng tất cả trình duyệt', message: `Đóng ${list.length} cửa sổ và dừng việc đang chạy trong đó?`, confirmLabel: 'Đóng tất cả', danger: true })) await send('close', list);
  }

  const devices = data?.devices.filter(d => !d.revoked) ?? [];
  const allChecked = rows.length > 0 && rows.every(r => selected.includes(r.profile.accountId));

  return <section className={styles.panel}>
    <div className={styles.sectionHeading}>
      <div><h2>Trình duyệt</h2><p>{openCount} cửa sổ đang mở · {queued} lệnh chờ luồng trống</p></div>
      <div className={styles.chips} role="group" aria-label="Lọc cửa sổ">
        <button className={filter === 'active' ? styles.chipActive : ''} aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>Đang chạy</button>
        <button className={filter === 'all' ? styles.chipActive : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Tất cả hồ sơ</button>
      </div>
    </div>

    <div className={styles.threads}>
      {devices.map(d => {
        const used = data!.profiles.filter(p => p.deviceId === d.id && OPEN.includes(p.status)).length;
        return <div key={d.id} className={`${styles.thread} ${d.id === deviceId ? styles.threadCurrent : ''}`}>
          <Layers size={18} />
          <div><b>{d.name}</b><small>{online(d.id) ? 'Online' : 'Offline'} · {used}/{d.maxWindows} cửa sổ</small></div>
          <label>Số luồng
            <select aria-label={`Số luồng của ${d.name}`} value={d.maxWindows} disabled={busy} onChange={e => void act('devices/settings', { id: d.id, maxWindows: Number(e.target.value) })}>
              {Array.from({ length: data!.maxWindowsLimit }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <meter min={0} max={d.maxWindows} value={Math.min(used, d.maxWindows)} aria-label={`${used} trên ${d.maxWindows} cửa sổ`} />
        </div>;
      })}
      {data && !devices.length && <small>Chưa có máy Windows nào được ghép.</small>}
    </div>
    <p className={styles.threadHint}>Số luồng là số cửa sổ chạy cùng lúc trên máy đó. Lệnh vượt quá sẽ chờ đến khi có cửa sổ đóng. Bản Windows từ 1.0.6 mới chạy song song.</p>

    <div className={styles.selectionBar}>
      <span><b>{picked.length}</b> đã chọn</span>
      <div className={styles.selectionButtons}>
        <button className="btn" disabled={busy || !picked.length} onClick={() => void send('open', picked.filter(r => !OPEN.includes(r.profile.status) && !r.active))}><Play size={15} />Mở</button>
        <button className="btn" disabled={busy || !picked.length} onClick={() => void send('hide', picked.filter(r => r.active?.kind !== 'hide'))}><EyeOff size={15} />Ẩn bài</button>
        <button className="btn" disabled={busy || !picked.length} onClick={() => void send('close', picked)}><Square size={15} />Đóng</button>
        <button className="btn btn-quiet" disabled={busy || !openCount} onClick={() => void closeAll()}>Đóng tất cả</button>
      </div>
    </div>

    <div className={styles.table}><table><thead><tr>
      <th><input type="checkbox" aria-label="Chọn tất cả cửa sổ đang hiển thị" checked={allChecked} disabled={!rows.length} onChange={e => setSelected(e.target.checked ? rows.map(r => r.profile.accountId) : [])} /></th>
      <th>Tài khoản</th><th>Cửa sổ</th><th>Đang làm</th><th>Máy</th><th>Proxy</th><th>Cập nhật</th><th><span className={styles.srOnly}>Thao tác</span></th>
    </tr></thead><tbody>{rows.map(r => {
      const { profile: p } = r;
      const isOpen = OPEN.includes(p.status);
      return <tr key={p.accountId} className={selected.includes(p.accountId) ? styles.selectedRow : ''}>
        <td><input type="checkbox" aria-label={`Chọn @${r.username}`} checked={selected.includes(p.accountId)} onChange={e => setSelected(s => e.target.checked ? [...s, p.accountId] : s.filter(id => id !== p.accountId))} /></td>
        <td><b>@{r.username}</b></td>
        <td><span className={`${styles.badge} ${styles[tone(p.status)]}`}>{statusLabel[p.status] ?? p.status}</span></td>
        <td>{r.active ? <><span className={`${styles.badge} ${styles.warn}`}>{jobLabel[r.active.kind] ?? r.active.kind} · {stateLabel[r.active.state] ?? r.active.state}</span>{r.active.kind === 'hide' && hideProgress(r.active.result) && <small>{hideProgress(r.active.result)}</small>}</> : <small>—</small>}</td>
        <td>{r.device?.name ?? '—'}<small>{r.device ? (online(r.device.id) ? 'Online' : 'Offline') : ''}</small></td>
        <td><small>{p.proxyLabel}</small></td>
        <td><small>{new Date(p.updatedAt * 1000).toLocaleString('vi-VN')}</small></td>
        <td><div className={styles.rowActions}>
          {isOpen || r.active
            ? <button className="btn btn-quiet" disabled={busy || !online(p.deviceId)} onClick={() => void send('close', [r])}><Square size={14} />Đóng</button>
            : <button className="btn btn-quiet" disabled={busy || !online(p.deviceId)} onClick={() => void send('open', [r])}><AppWindow size={14} />Mở</button>}
        </div></td>
      </tr>;
    })}</tbody></table></div>
    {data && !rows.length && <div className={styles.empty}><AppWindow size={30} /><b>{filter === 'active' ? 'Không có trình duyệt nào đang chạy' : 'Chưa có hồ sơ trình duyệt'}</b><span>Mở trình duyệt từ danh sách TikTok hoặc chuyển sang “Tất cả hồ sơ”.</span></div>}
  </section>;
}
