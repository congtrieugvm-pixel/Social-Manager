'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Monitor, Shield, Play, Square, Send, Users, History, Search, RefreshCw, FolderOpen, Plus, X, CheckCircle2, AlertCircle, EyeOff } from 'lucide-react';
import { confirmDialog } from '@/app/_components/notify';
import { postJson, safeJson } from '@/lib/req-body';
import type { dashboard } from '@/lib/browser-service';
import styles from './manager.module.css';

type Data = Awaited<ReturnType<typeof dashboard>>;
type Account = Data['accounts'][number];
type Section = 'accounts' | 'posting' | 'proxies' | 'devices' | 'activity';
const sections = [
  { id: 'accounts', label: 'Tài khoản', icon: Users },
  { id: 'posting', label: 'Đăng bài', icon: Send },
  { id: 'proxies', label: 'Proxy', icon: Shield },
  { id: 'devices', label: 'Máy Windows', icon: Monitor },
  { id: 'activity', label: 'Lịch sử', icon: History },
] as const;
function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'good' | 'warn' | 'neutral' | 'danger' }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
const labels: Record<string, string> = { starting: 'Đang mở', open: 'Đã mở', needs_verification: 'Cần xác minh', unverified: 'Chưa xác minh tài khoản', logged_in: 'Đã đăng nhập', wrong_account: 'Đăng nhập nhầm tài khoản', closed: 'Đã đóng', error: 'Có lỗi', interrupted: 'Bị gián đoạn', revoked: 'Đã thu hồi', queued: 'Đang chờ máy nhận lệnh', claimed: 'Máy đã nhận lệnh', running: 'Đang chạy', done: 'Hoàn tất', expired: 'Hết hạn', cancelled: 'Đã hủy' };
const errorMessages: Record<string, string> = {
  FOLDER_EMPTY: 'Hết video chưa dùng trong thư mục', FOLDER_INVALID: 'Không đọc được thư mục trên máy Windows',
  POST_UNKNOWN: 'Chưa xác nhận kết quả. Kiểm tra tab TikTok trước khi thao tác tiếp',
  POST_MANUAL: 'Cần kiểm tra tài khoản, CAPTCHA hoặc form đăng trong cửa sổ TikTok',
  BROWSER_FAILED: 'Không mở được browser. Cập nhật chương trình Windows và thử lại',
  PROFILE_BUSY: 'Hồ sơ đang được dùng hoặc còn khóa sau sự cố', PROXY_FAILED: 'Kiểm tra kết nối proxy trên máy Windows',
  HIDE_MANUAL: 'Chưa vào được TikTok Studio đúng tài khoản (cần đăng nhập/xác minh, hoặc trang bị tải lại). Chạy lại sau khi kiểm tra cửa sổ',
  HIDE_FAILED: 'Chưa ẩn hết bài. Xem thông báo cuối rồi chạy lại; bài đã riêng tư sẽ được bỏ qua',
  CLOSED: 'Cửa sổ bị đóng trước khi xong', INTERRUPTED: 'Đã dừng giữa chừng', CONFIG_CHANGED: 'Cấu hình đã đổi; gửi lại lệnh',
};
const kindLabels: Record<string, string> = { open: 'Mở browser', close: 'Đóng browser', post: 'Đăng video', preview: 'Xem trước video', check_proxy: 'Kiểm tra proxy', hide: 'Ẩn bài (Chỉ mình tôi)' };
type HideResult = { changed: number; skipped: number; scanned: number; message: string; status: string | null };
function hideResult(job: { kind: string; result: string | null }): HideResult | null {
  if (job.kind !== 'hide' || !job.result) return null;
  try { return JSON.parse(job.result) as HideResult; } catch { return null; }
}
const hideSummary = (r: HideResult) => `${r.changed} bài đã ẩn · ${r.skipped} bài vốn riêng tư`;
const blankProxy = { id: 0, name: '', server: '', username: '', password: '', enabled: true, clearUsername: false, clearPassword: false };
export default function BrowserManager() {
  const [section, setSection] = useState<Section>('accounts');
  const [data, setData] = useState<Data>();
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<number[]>([]); const [deviceId, setDeviceId] = useState('');
  const [autofill, setAutofill] = useState(true); const [mode, setMode] = useState('inherit'); const [proxyId, setProxyId] = useState('');
  const [editing, setEditing] = useState(false); const [proxy, setProxy] = useState(blankProxy);
  const [postFolder, setPostFolder] = useState('');
  const [postCaption, setPostCaption] = useState('');
  const [postGroup, setPostGroup] = useState('');
  const [loadingPostGroup, setLoadingPostGroup] = useState(false);
  const groupRequest = useRef(0);
  const refreshRequest = useRef(0);
  const deviceSelectionResolved = useRef(false);
  async function selectPostingGroup(value: string) {
    const request = ++groupRequest.current;
    setPostGroup(value);
    setSelected([]);
    if (!value) { setFilter(''); setLoadingPostGroup(false); return; }
    setLoadingPostGroup(true);
    setError('');
    try {
      const res = await postJson('/api/accounts/selection', { groups: [value === 'none' ? 'none' : Number(value)] });
      const result = await safeJson<{ ids: number[] }>(res);
      if (request !== groupRequest.current) return;
      if (!res.ok || result.error) throw new Error(result.error || 'Không thể chọn nhóm');
      const list = result.ids.slice(0, 20);
      setSelected(list); setFilter(list.length ? 'ids=' + list.join(',') : 'q=' + encodeURIComponent('__empty_group__'));
      if (result.ids.length > 20) setMessage(`Nhóm có ${result.ids.length} tài khoản. Đang chọn 20 tài khoản đầu cho lượt này.`);
    } catch (e) { if (request === groupRequest.current) setError(e instanceof Error ? e.message : 'Không thể chọn nhóm'); }
    finally { if (request === groupRequest.current) setLoadingPostGroup(false); }
  }
  const refresh = useCallback(async () => {
    const request = ++refreshRequest.current;
    const res = await fetch('/api/browser/dashboard?' + filter, { cache: 'no-store' });
    const value = await safeJson<Data>(res);
    if (!res.ok || value.error) throw new Error(value.error || 'Không thể tải dữ liệu');
    if (request !== refreshRequest.current) return;
    setData(value);
    if (!deviceSelectionResolved.current) {
      const saved = localStorage.getItem(`browser-device-${value.owner}`);
      const remembered = value.devices.find(device => device.id === saved && !device.revoked);
      const eligible = value.devices.filter(device => !device.revoked && device.lastSeenAt >= value.now - 60);
      const initialDevice = remembered?.id ?? (eligible.length === 1 ? eligible[0].id : '');
      if (initialDevice) {
        deviceSelectionResolved.current = true;
        setDeviceId(current => current || initialDevice);
      }
    }
  }, [filter]);
  useEffect(() => {
    const ids = new URLSearchParams(location.search).get('ids');
    if (ids) { const list = ids.split(',').map(Number).filter(n => Number.isSafeInteger(n) && n > 0).slice(0, 20); setSelected(list); setFilter('ids=' + list.join(',')); }
  }, []);
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!live) return;
      if (!document.hidden) await refresh().catch(e => { if (live) setError(e.message); });
      if (live) timer = setTimeout(tick, 3000);
    };
    void tick(); return () => { live = false; clearTimeout(timer); };
  }, [refresh]);
  async function act(route: string, body: unknown) {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await postJson('/api/browser/' + route, body);
      const value = await safeJson<{ code?: string; expiresAt?: number; results?: { id: number; ok: boolean; error?: string }[] }>(res);
      if (!res.ok || value.error) throw new Error(value.error || 'Thao tác thất bại');
      const failed = value.results?.filter(r => !r.ok) ?? [];
      if (failed.length) setError(failed.map(r => `#${r.id}: ${r.error}`).join(' · '));
      else setMessage(route === 'jobs' ? 'Đã gửi lệnh. Máy đang rảnh có thể mất 15 giây để nhận.' : 'Đã lưu thay đổi.');
      if (route === 'proxies/save') { setEditing(false); setProxy(blankProxy); }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể thực hiện'); }
    finally { setBusy(false); }
  }
  const online = data?.devices.filter(d => !d.revoked && d.lastSeenAt >= data.now - 60) ?? [];
  const selectedDevice = online.find(d => d.id === deviceId);
  const openBlockedReason = busy ? 'Đang xử lý thao tác trước…'
    : loadingPostGroup ? 'Đang chọn tài khoản theo nhóm…'
    : !selected.length ? 'Chọn tài khoản trong danh sách để mở trình duyệt.'
    : !deviceId ? online.length ? 'Chọn máy Windows ở phía trên.' : 'Máy Windows chưa online. Mở Setup trên máy Windows để kết nối lại.'
    : !selectedDevice ? 'Máy đã chọn đang mất kết nối. Mở Setup trên máy Windows rồi bấm làm mới trạng thái.' : '';
  function connection(a: NonNullable<Data>['accounts'][number]) {
    const id = a.mode === 'custom' ? a.proxyId : a.mode === 'inherit' ? data?.groups.find(g => g.id === a.groupId)?.proxyId : null;
    const p = data?.proxies.find(p => p.id === id);
    return id ? `${a.mode === 'custom' ? 'Riêng' : 'Nhóm'}: ${p?.name ?? 'Không tìm thấy proxy'}${p && !p.enabled ? ' (đã tắt)' : ''}` : 'Không dùng proxy';
  }
  const selectedAccounts = data?.accounts.filter(account => selected.includes(account.id)) ?? [];
  const availableDevices = data?.devices.filter(device => !device.revoked) ?? [];
  const connectedDevice = availableDevices.find(device => device.id === deviceId);
  const activeProfiles = data?.profiles.filter(profile => ['starting', 'open', 'logged_in', 'unverified', 'needs_verification', 'wrong_account'].includes(profile.status)) ?? [];
  const pendingJobs = data?.jobs.filter(job => ['queued', 'claimed'].includes(job.state)) ?? [];
  function configurationChanged(account: Account) {
    const profile = data?.profiles.find(profile => profile.accountId === account.id);
    if (!profile?.configKey) return false;
    const inheritedProxy = data?.groups.find(group => group.id === account.groupId)?.proxyId ?? null;
    const effectiveProxyId = account.mode === 'custom' ? account.proxyId : account.mode === 'inherit' ? inheritedProxy : null;
    const revision = data?.proxies.find(proxy => proxy.id === effectiveProxyId)?.revision ?? 0;
    return profile.configKey !== JSON.stringify([account.groupId, account.mode, effectiveProxyId, revision, account.username]);
  }
  function readiness(account: Account): { ready: boolean; text: string; tone: 'good' | 'warn' | 'neutral' } {
    if (!deviceId) return { ready: false, text: 'Chọn máy Windows', tone: 'neutral' };
    if (!connectedDevice) return { ready: false, text: 'Máy đã ngắt kết nối', tone: 'warn' };
    if (!selectedDevice) return { ready: false, text: 'Máy đang offline', tone: 'warn' };
    const version = selectedDevice.version.split('.').map(Number);
    if (!/^\d+\.\d+\.\d+$/.test(selectedDevice.version) || version[0] < 1 || (version[0] === 1 && version[1] === 0 && version[2] < 3)) {
      return { ready: false, text: 'Cần Windows 1.0.3 trở lên', tone: 'warn' };
    }
    const profile = data?.profiles.find(profile => profile.accountId === account.id);
    const group = data?.groups.find(group => group.id === account.groupId);
    if (account.mode === 'inherit' && account.groupId !== null && !group) return { ready: false, text: 'Nhóm không còn hợp lệ', tone: 'warn' };
    const proxyId = account.mode === 'custom' ? account.proxyId : account.mode === 'inherit' ? group?.proxyId : null;
    const proxy = data?.proxies.find(proxy => proxy.id === proxyId);
    if ((account.mode === 'custom' && !proxy) || (proxyId && !proxy)) return { ready: false, text: 'Proxy không hợp lệ', tone: 'warn' };
    if (proxy && !proxy.enabled) return { ready: false, text: 'Proxy đã tắt', tone: 'warn' };
    if (!profile || ['closed', 'revoked', 'interrupted', 'error'].includes(profile.status)) return { ready: false, text: 'Cần mở trình duyệt', tone: 'neutral' };
    if (profile.deviceId !== deviceId) return { ready: false, text: 'Phiên nằm trên máy khác', tone: 'warn' };
    if (profile.status !== 'logged_in') return { ready: false, text: labels[profile.status] ?? 'Cần xác minh tài khoản', tone: 'warn' };
    const config = data?.posting.find(config => config.accountId === account.id);
    if (!config || config.deviceId !== deviceId) return { ready: false, text: 'Chưa gán thư mục trên máy này', tone: 'neutral' };
    if (data?.jobs.some(job => job.accountId === account.id && job.kind === 'post' && ['queued', 'claimed', 'running'].includes(job.state))) return { ready: false, text: 'Đang có lệnh đăng bài', tone: 'warn' };
    return { ready: true, text: 'Sẵn sàng đăng', tone: 'good' };
  }
  const readyCount = selectedAccounts.filter(account => readiness(account).ready).length;
  const canPost = !busy && !loadingPostGroup && selected.length > 0 && readyCount === selected.length;
  const hideVersionOk = !!selectedDevice && /^\d+\.\d+\.\d+$/.test(selectedDevice.version) && (() => {
    const [a, b, c] = selectedDevice.version.split('.').map(Number);
    return a !== 1 ? a > 1 : b !== 0 ? b > 0 : c >= 4;
  })();
  const hideBlockedReason = openBlockedReason || (!hideVersionOk ? 'Cập nhật chương trình Windows lên 1.0.4 để dùng Ẩn bài.' : '');
  async function hidePosts(ids: number[]) {
    if (!ids.length || !selectedDevice || !hideVersionOk) return;
    const names = data?.accounts.filter(account => ids.includes(account.id)).map(account => '@' + account.username) ?? [];
    const confirmed = await confirmDialog({
      title: 'Ẩn bài sang Chỉ mình tôi',
      message: `Mở TikTok Studio trên ${selectedDevice?.name} và chuyển TOÀN BỘ bài công khai của ${ids.length === 1 ? names[0] : `${ids.length} tài khoản`} sang Chỉ mình tôi? Bài đã riêng tư được giữ nguyên. Bấm Đóng ở tài khoản để dừng giữa chừng.`,
      confirmLabel: 'Ẩn bài',
    });
    if (confirmed) await act('jobs', { kind: 'hide', ids, deviceId, autofill });
  }
  async function publish() {
    if (!canPost) return;
    const confirmed = await confirmDialog({
      title: 'Đăng video lên TikTok',
      message: `Đăng 1 video tiếp theo cho ${selected.length} tài khoản đã chọn trên ${selectedDevice?.name}?`,
      confirmLabel: 'Đăng video',
    });
    if (confirmed) await act('jobs', { kind: 'post', ids: selected, deviceId });
  }
  function changeSelection(accountId: number, checked: boolean) {
    setPostGroup('');
    setSelected(current => checked ? [...new Set([...current, accountId])].slice(0, 20) : current.filter(id => id !== accountId));
  }
  const toggleableAccounts = data?.accounts.slice(0, 20) ?? [];
  const allVisibleSelected = toggleableAccounts.length > 0 && toggleableAccounts.every(account => selected.includes(account.id));
  return <div className={styles.page}>
    <header className={styles.header}>
      <div><h1>Proxy & trình duyệt</h1><p>Quản lý phiên TikTok và đăng video từ máy Windows.</p></div>
      <Link href="/" className="btn"><Users size={16} />Danh sách TikTok</Link>
    </header>

    <div className={styles.overview} aria-label="Tổng quan trình duyệt">
      {[
        { label: 'Máy kết nối', value: online.length, detail: `${availableDevices.length} máy đã ghép`, icon: Monitor },
        { label: 'Phiên đang mở', value: activeProfiles.length, detail: `${data?.profiles.filter(profile => profile.status === 'logged_in').length ?? 0} đã xác minh`, icon: Users },
        { label: 'Proxy', value: data?.proxies.length ?? 0, detail: `${data?.proxies.filter(proxy => proxy.enabled).length ?? 0} đang bật`, icon: Shield },
        { label: 'Lệnh đang chờ', value: pendingJobs.length, detail: 'Mở, đóng và đăng video', icon: History },
      ].map(item => <div key={item.label} className={styles.metric}><item.icon size={19} /><div><span>{item.label}</span><strong>{data ? item.value : '—'}</strong><small>{item.detail}</small></div></div>)}
    </div>

    <div className={styles.connectionBar}>
      <Monitor size={21} className={styles.connectionIcon} />
      <label>Máy chạy<select aria-label="Máy chạy" value={deviceId} disabled={busy} onChange={event => {
        deviceSelectionResolved.current = true;
        setDeviceId(event.target.value);
        if (data) localStorage.setItem(`browser-device-${data.owner}`, event.target.value);
      }}><option value="">Chọn máy Windows</option>{deviceId && !connectedDevice && <option value={deviceId}>Máy đã ngắt kết nối — chọn lại máy</option>}{availableDevices.map(device => <option key={device.id} value={device.id}>{device.name} · {online.some(item => item.id === device.id) ? 'Online' : 'Offline'}</option>)}</select></label>
      <div className={styles.connectionState}>
        <Badge tone={selectedDevice ? 'good' : 'warn'}>{selectedDevice ? 'Đã kết nối' : connectedDevice ? 'Mất kết nối' : 'Chưa chọn máy'}</Badge>
        <small>{connectedDevice ? `Windows · v${connectedDevice.version}` : 'Chưa có máy được chọn'}</small>
      </div>
      <button className="btn btn-quiet" onClick={() => setSection('devices')}>Quản lý máy</button>
      <button className="btn btn-icon" aria-label="Làm mới trạng thái" disabled={busy} onClick={() => void refresh().catch(error => setError(error.message))}><RefreshCw size={16} /></button>
    </div>

    {error && <div className={styles.error} role="alert"><AlertCircle size={18} /><span>{error}</span><button aria-label="Đóng thông báo lỗi" onClick={() => setError('')}><X size={16} /></button></div>}
    {message && <div className={styles.message} role="status"><CheckCircle2 size={18} /><span>{message}</span><button aria-label="Đóng thông báo" onClick={() => setMessage('')}><X size={16} /></button></div>}

    <nav className={styles.navigation} aria-label="Quản lý trình duyệt">
      {sections.map(item => <button key={item.id} className={section === item.id ? styles.navActive : ''} aria-pressed={section === item.id} onClick={() => setSection(item.id)}><item.icon size={17} />{item.label}{item.id === 'activity' && pendingJobs.length > 0 && <span>{pendingJobs.length}</span>}</button>)}
    </nav>

    {!data && <div className={styles.loading} role="status">Đang tải tài khoản và phiên trình duyệt…</div>}
    <div hidden={section !== 'accounts'}>
      <section className={styles.panel}>
        <div className={styles.sectionHeading}><div><h2>Tài khoản & phiên</h2><p>{data?.accounts.length ?? 0} tài khoản đang hiển thị</p></div><Badge>{selected.length}/20 đã chọn</Badge></div>
        <div className={styles.filters}>
          <form className={styles.search} onSubmit={event => { event.preventDefault(); groupRequest.current++; setLoadingPostGroup(false); setPostGroup(''); setSelected([]); setFilter('q=' + encodeURIComponent(query)); }}>
            <Search size={17} /><input aria-label="Tìm username" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm username…" /><button className="btn" disabled={busy}>Tìm kiếm</button>
          </form>
          <label className={styles.inlineLabel}>Chọn nhóm<select aria-label="Chọn nhóm tài khoản" value={postGroup} disabled={busy} onChange={event => void selectPostingGroup(event.target.value)}><option value="">Tất cả nhóm</option><option value="none">Không nhóm</option>{data?.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        </div>
        <div className={styles.selectionBar}>
          <span><b>{selected.length}</b> đã chọn</span>
          <button className="btn btn-quiet" disabled={!selected.length || busy} onClick={() => { groupRequest.current++; setLoadingPostGroup(false); setSelected([]); setPostGroup(''); }}>Bỏ chọn</button>
          <div className={styles.selectionButtons}>
            <button className="btn btn-primary" title={openBlockedReason || 'Mở các tài khoản đã chọn'} aria-describedby={openBlockedReason ? 'browser-open-status' : undefined} disabled={!!openBlockedReason} onClick={() => void act('jobs', { kind: 'open', ids: selected, deviceId, autofill })}><Play size={15} />Mở trình duyệt</button>
            <button className="btn" disabled={busy || loadingPostGroup || !selected.length || !selectedDevice} onClick={() => void act('jobs', { kind: 'close', ids: selected, deviceId })}><Square size={15} />Đóng</button>
            <button className="btn" title={hideBlockedReason || 'Chuyển toàn bộ bài công khai sang Chỉ mình tôi'} disabled={!!hideBlockedReason} onClick={() => void hidePosts(selected)}><EyeOff size={15} />Ẩn bài</button>
            <button className="btn" disabled={!selected.length || loadingPostGroup} onClick={() => setSection('posting')}><Send size={15} />Đăng bài</button>
          </div>
        </div>
        {openBlockedReason && <p id="browser-open-status" role="status" className={styles.openStatus}>{openBlockedReason}</p>}
        <div className={styles.table}><table><thead><tr>
          <th><input aria-label="Chọn 20 tài khoản đầu đang hiển thị" type="checkbox" checked={allVisibleSelected} disabled={busy || loadingPostGroup || !toggleableAccounts.length} onChange={event => { setPostGroup(''); setSelected(event.target.checked ? toggleableAccounts.map(account => account.id) : []); }} /></th>
          <th>Tài khoản TikTok</th><th>Proxy lần mở tới</th><th>Phiên trình duyệt</th><th>Máy lưu hồ sơ</th><th><span className={styles.srOnly}>Thao tác hồ sơ</span></th>
        </tr></thead><tbody>{data?.accounts.map(account => {
          const profile = data.profiles.find(profile => profile.accountId === account.id);
          const device = data.devices.find(device => device.id === profile?.deviceId);
          const hideJob = data.jobs.find(job => job.accountId === account.id && job.kind === 'hide'); // newest first
          const hiding = hideJob && ['queued', 'claimed', 'running'].includes(hideJob.state) ? hideJob : null;
          const hide = hideJob ? hideResult(hideJob) : null;
          return <tr key={account.id} className={selected.includes(account.id) ? styles.selectedRow : ''}>
            <td><input aria-label={`Chọn ${account.username}`} type="checkbox" checked={selected.includes(account.id)} disabled={busy || loadingPostGroup || (!selected.includes(account.id) && selected.length >= 20)} onChange={event => changeSelection(account.id, event.target.checked)} /></td>
            <td><b>@{account.username}</b><small>{data.groups.find(group => group.id === account.groupId)?.name ?? 'Không nhóm'}</small></td>
            <td>{connection(account)}{profile && <small>Phiên gần nhất · {profile.proxyLabel}</small>}{configurationChanged(account) && <small>Cấu hình mới áp dụng khi mở lại</small>}</td>
            <td><Badge tone={profile?.status === 'logged_in' ? 'good' : ['error', 'wrong_account', 'needs_verification', 'interrupted'].includes(profile?.status ?? '') ? 'warn' : 'neutral'}>{profile ? labels[profile.status] ?? profile.status : 'Chưa mở'}</Badge>{profile && <small>{new Date(profile.updatedAt * 1000).toLocaleString('vi-VN')}</small>}
              {hideJob && (hiding || hideJob.createdAt > data.now - 86400) && <div className={styles.hideStatus} role="status">
                <Badge tone={hiding ? 'warn' : hideJob.state === 'done' ? 'good' : 'danger'}><EyeOff size={12} />{hiding ? (hiding.state === 'running' ? 'Đang ẩn bài' : 'Chờ máy ẩn bài') : hideJob.state === 'done' ? 'Đã ẩn hết bài công khai' : 'Ẩn bài chưa xong'}</Badge>
                {hide && <small>{hideSummary(hide)}</small>}
                {hiding ? hide?.message && <small>{hide.message}</small> : hideJob.error && <small>{errorMessages[hideJob.error] ?? hideJob.error}</small>}
              </div>}</td>
            <td>{device?.name ?? '—'}{device && <small>{online.some(item => item.id === device.id) ? 'Online' : 'Offline'}</small>}</td>
            <td><button className="btn btn-quiet" aria-label={`Ẩn bài ${account.username}`} title={hiding ? 'Đang ẩn bài' : !selectedDevice ? 'Chọn máy Windows đang online' : !hideVersionOk ? 'Cần Windows 1.0.4' : 'Chuyển toàn bộ bài công khai sang Chỉ mình tôi'} disabled={busy || loadingPostGroup || !selectedDevice || !hideVersionOk || !!hiding} onClick={() => void hidePosts([account.id])}><EyeOff size={14} />Ẩn bài</button><button className="btn" aria-label={`Mở trình duyệt ${account.username}`} disabled={busy || loadingPostGroup || !selectedDevice} title={!selectedDevice ? 'Chọn máy Windows đang online để mở' : undefined} onClick={() => void act('jobs', { kind: 'open', ids: [account.id], deviceId, autofill })}><Play size={14} />Mở</button>{profile && <button className="btn btn-quiet" disabled={busy} onClick={async () => {
              if (await confirmDialog({ title: 'Tạo hồ sơ trên máy khác', message: `Xác nhận đã dừng browser của @${account.username} trên máy cũ. Hồ sơ mới cần đăng nhập lại.`, confirmLabel: 'Tạo hồ sơ mới' })) void act('profiles/relocate', { accountId: account.id, confirmStopped: true });
            }}>Chuyển máy</button>}</td>
          </tr>;
        })}</tbody></table></div>
        {data && !data.accounts.length && <div className={styles.empty}><Users size={30} /><b>Chưa có tài khoản phù hợp</b><span>Thay đổi tìm kiếm hoặc chọn nhóm khác.</span><Link href="/" className="btn">Xem tài khoản TikTok</Link></div>}
        <div className={styles.accountOptions}>
          <label><input type="checkbox" checked={autofill} onChange={event => setAutofill(event.target.checked)} />Điền thông tin đăng nhập đã lưu</label>
          <div className={styles.row}><label>Proxy cho tài khoản đã chọn<select value={mode} onChange={event => setMode(event.target.value)}><option value="inherit">Dùng proxy của nhóm</option><option value="custom">Dùng proxy riêng</option><option value="direct">Không dùng proxy</option></select></label>
            {mode === 'custom' && <label>Proxy riêng<select value={proxyId} onChange={event => setProxyId(event.target.value)}><option value="">Chọn proxy</option>{data?.proxies.map(proxy => <option key={proxy.id} value={proxy.id}>{proxy.name}</option>)}</select></label>}
            <button className="btn" disabled={busy || loadingPostGroup || !selected.length || (mode === 'custom' && !proxyId)} onClick={() => void act('assign', { ids: selected, mode, proxyId: mode === 'custom' ? Number(proxyId) : null })}>Gán proxy</button>
          </div>
        </div>
      </section>
    </div>

    <div hidden={section !== 'posting'}>
      <section className={styles.panel}>
        <div className={styles.sectionHeading}><div><h2>Đăng video từ thư mục</h2><p>{selected.length ? `${readyCount}/${selected.length} tài khoản sẵn sàng trên máy đã chọn` : 'Chọn tài khoản để chuẩn bị đăng bài'}</p></div><Badge tone={canPost ? 'good' : 'neutral'}>{readyCount} sẵn sàng</Badge></div>
        <div className={styles.postingLayout}>
          <div className={styles.postForm}>
            <label>Chọn theo nhóm<select aria-label="Chọn theo nhóm" value={postGroup} onChange={event => void selectPostingGroup(event.target.value)} disabled={busy}><option value="">Dùng tài khoản đã chọn</option><option value="none">Không nhóm</option>{data?.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
            <label>Thư mục video trên máy Windows<input value={postFolder} onChange={event => setPostFolder(event.target.value)} placeholder={'D:\\Videos\\TikTok'} /><small>Gán cho một tài khoản hoặc dùng chung cho các tài khoản đã chọn.</small></label>
            <label>Nội dung bài đăng<textarea value={postCaption} onChange={event => setPostCaption(event.target.value)} maxLength={2200} rows={4} placeholder="Để trống để dùng tên video" /><small className={styles.characterCount}>{postCaption.length}/2200</small></label>
            <button className="btn" disabled={busy || loadingPostGroup || !selected.length || !connectedDevice || !postFolder.trim()} onClick={() => void act('posting/save', { ids: selected, deviceId, folder: postFolder, caption: postCaption })}><FolderOpen size={16} />Gán thư mục cho {selected.length} tài khoản</button>
          </div>
          <div className={styles.publishBox}>
            <Send size={24} /><h3>Lượt đăng tiếp theo</h3>
            <div><strong>{selected.length}</strong><span>tài khoản đã chọn</span></div>
            <p>Mỗi tài khoản đăng một video chưa dùng, theo thứ tự tên file trong thư mục đã gán.</p>
            <button className="btn btn-primary" disabled={!canPost} onClick={() => void publish()}><Send size={16} />Đăng video tiếp theo</button>
            {!canPost && <small>{!selected.length ? 'Chọn tài khoản trong mục Tài khoản hoặc chọn nhóm.' : 'Xem trạng thái từng tài khoản bên dưới để hoàn tất chuẩn bị.'}</small>}
            <button className="btn btn-quiet" disabled={!selected.length || !selectedDevice || busy || loadingPostGroup} onClick={() => void act('jobs', { kind: 'open', ids: selected, deviceId, autofill })}><Play size={15} />Mở phiên đã chọn</button>
          </div>
        </div>
        <div className={`${styles.table} ${styles.postingTable}`}><table><thead><tr><th>Tài khoản</th><th>Thư mục đã gán</th><th>Máy Windows</th><th>Trạng thái đăng bài</th></tr></thead><tbody>{selectedAccounts.map(account => {
          const config = data?.posting.find(config => config.accountId === account.id);
          const state = readiness(account);
          return <tr key={account.id}><td data-label="Tài khoản"><b>@{account.username}</b></td><td data-label="Thư mục" className={styles.path}>{config?.folder ?? 'Chưa gán'}</td><td data-label="Máy Windows">{data?.devices.find(device => device.id === config?.deviceId)?.name ?? '—'}</td><td data-label="Trạng thái"><Badge tone={state.tone}>{state.text}</Badge></td></tr>;
        })}</tbody></table></div>
        {!selected.length && <div className={styles.empty}><Users size={28} /><b>Chưa chọn tài khoản</b><button className="btn" onClick={() => setSection('accounts')}>Chọn tài khoản TikTok</button></div>}
      </section>
    </div>

    <div hidden={section !== 'proxies'}>
      <div className={styles.proxyLayout}>
        <section className={styles.panel}>
          <div className={styles.sectionHeading}><div><h2>Danh sách proxy</h2><p>{data?.proxies.length ?? 0} proxy</p></div><button className="btn btn-primary" onClick={() => { setProxy(blankProxy); setEditing(true); }}><Plus size={16} />Thêm proxy</button></div>
          {editing && <form className={styles.form} onSubmit={event => { event.preventDefault(); void act('proxies/save', proxy); }}>
            <h3>{proxy.id ? 'Sửa proxy' : 'Thêm proxy'}</h3>
            <label>Tên<input required value={proxy.name} onChange={event => setProxy({ ...proxy, name: event.target.value })} /></label>
            <label>Địa chỉ<input required placeholder="http://host:port" value={proxy.server} onChange={event => setProxy({ ...proxy, server: event.target.value })} /></label>
            <label>Username<input autoComplete="off" placeholder="Để trống để giữ nguyên" value={proxy.username} onChange={event => setProxy({ ...proxy, username: event.target.value })} /></label>
            <label>Password<input type="password" autoComplete="new-password" placeholder="Để trống để giữ nguyên" value={proxy.password} onChange={event => setProxy({ ...proxy, password: event.target.value })} /></label>
            <label><input type="checkbox" checked={proxy.enabled} onChange={event => setProxy({ ...proxy, enabled: event.target.checked })} />Bật proxy</label>
            {!!proxy.id && <><label><input type="checkbox" checked={proxy.clearUsername} onChange={event => setProxy({ ...proxy, clearUsername: event.target.checked })} />Xóa username đã lưu</label><label><input type="checkbox" checked={proxy.clearPassword} onChange={event => setProxy({ ...proxy, clearPassword: event.target.checked })} />Xóa password đã lưu</label></>}
            <div className={styles.row}><button className="btn btn-primary" disabled={busy}>Lưu</button><button type="button" className="btn" disabled={busy} onClick={() => { setEditing(false); setProxy(blankProxy); }}>Hủy</button></div>
          </form>}
          {data?.proxies.map(proxy => {
            const check = data.checks.find(check => check.proxyId === proxy.id && check.deviceId === deviceId && check.revision === proxy.revision);
            return <div key={proxy.id} className={styles.proxy}>
              <div className={styles.proxyHeading}><b>{proxy.name}</b><Badge tone={!proxy.enabled ? 'neutral' : check?.ip ? 'good' : check?.error ? 'warn' : 'neutral'}>{!proxy.enabled ? 'Đã tắt' : check?.ip ? 'Kết nối tốt' : check?.error ? 'Kiểm tra thất bại' : 'Chưa kiểm tra'}</Badge></div>
              <code>{proxy.server}</code><small>{check?.ip ? `IP ${check.ip} · ${check.latency ?? '?'} ms` : 'Kiểm tra từ máy Windows đang chọn'} · {proxy.hasPassword ? 'Đã lưu mật khẩu' : 'Không có mật khẩu'}</small>
              <div className={styles.row}><button className="btn" disabled={busy || !selectedDevice || !proxy.enabled} onClick={() => void act('jobs', { kind: 'check_proxy', proxyId: proxy.id, deviceId })}>Kiểm tra</button><button className="btn" disabled={busy} onClick={() => { setProxy({ ...blankProxy, id: proxy.id, name: proxy.name, server: proxy.server, enabled: !!proxy.enabled }); setEditing(true); }}>Sửa</button><button className="btn btn-quiet" disabled={busy} onClick={async () => { if (await confirmDialog({ message: `Xóa proxy ${proxy.name}?`, confirmLabel: 'Xóa', danger: true })) void act('proxies/delete', { id: proxy.id }); }}>Xóa</button></div>
            </div>;
          })}
          {data && !data.proxies.length && !editing && <div className={styles.empty}><Shield size={30} /><b>Chưa có proxy</b><span>Thêm proxy để gán cho tài khoản hoặc nhóm.</span></div>}
        </section>
        <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>Proxy theo nhóm</h2><p>Áp dụng từ lần mở browser tiếp theo.</p></div></div>
          {data?.groups.map(group => <label className={styles.group} key={group.id}>{group.name}<select aria-label={`Proxy nhóm ${group.name}`} disabled={busy} value={group.proxyId ?? ''} onChange={event => void act('assign', { groupId: group.id, proxyId: event.target.value ? Number(event.target.value) : null })}><option value="">Không dùng proxy</option>{data.proxies.map(proxy => <option key={proxy.id} value={proxy.id}>{proxy.name}</option>)}</select></label>)}
          {data && !data.groups.length && <div className={styles.empty}><Users size={28} /><span>Chưa có nhóm tài khoản.</span></div>}
        </section>
      </div>
    </div>

    <div hidden={section !== 'devices'}>
      <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>Máy Windows</h2><p>{online.length} online · {availableDevices.length} máy đã ghép</p></div></div>
        {availableDevices.map(device => <div key={device.id} className={styles.device}><div className={styles.deviceIcon}><Monitor size={22} /></div><div className={styles.deviceInfo}><b>{device.name}</b><small>Windows · v{device.version}</small><small>Lần kết nối gần nhất · {new Date(device.lastSeenAt * 1000).toLocaleString('vi-VN')}</small></div><Badge tone={online.some(item => item.id === device.id) ? 'good' : 'warn'}>{online.some(item => item.id === device.id) ? 'Online' : 'Offline'}</Badge><button className="btn btn-quiet" disabled={busy} onClick={async () => { if (await confirmDialog({ title: 'Ngắt kết nối máy', message: `Ngắt ${device.name}? Các phiên sẽ đóng khi máy nhận thu hồi hoặc hết quyền chạy trong 90 giây.`, confirmLabel: 'Ngắt kết nối', danger: true })) void act('devices/revoke', { id: device.id }); }}>Ngắt kết nối</button></div>)}
        {data && !availableDevices.length && <div className={styles.empty}><Monitor size={30} /><b>Chưa có máy kết nối</b></div>}
      </section>
    </div>

    <div hidden={section !== 'activity'}>
      <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>Hàng đợi & lịch sử</h2><p>{pendingJobs.length} lệnh chờ · tối đa 3 cửa sổ mỗi máy</p></div></div>
        <div className={styles.table}><table><thead><tr><th>Thao tác</th><th>Tài khoản / proxy</th><th>Trạng thái</th><th>Thời gian</th><th><span className={styles.srOnly}>Hủy lệnh</span></th></tr></thead><tbody>{data?.jobs.map(job => <tr key={job.id}>
          <td>{kindLabels[job.kind] ?? job.kind}{(() => { const r = hideResult(job); return r && <small>{hideSummary(r)}</small>; })()}</td>
          <td>{data.accounts.find(account => account.id === job.accountId)?.username ?? (job.accountId ? `#${job.accountId}` : data.proxies.find(proxy => proxy.id === job.proxyId)?.name)}</td>
          <td><Badge tone={job.state === 'done' ? 'good' : job.state === 'error' ? 'danger' : ['queued', 'claimed', 'running'].includes(job.state) ? 'warn' : 'neutral'}>{labels[job.state] ?? job.state}</Badge>{job.error && <small>{errorMessages[job.error] ?? job.error}</small>}</td>
          <td>{new Date(job.createdAt * 1000).toLocaleString('vi-VN')}</td><td>{['queued', 'claimed'].includes(job.state) && <button className="btn" disabled={busy} onClick={() => void act('jobs/cancel', { id: job.id })}>Hủy</button>}</td>
        </tr>)}</tbody></table></div>
        {data && !data.jobs.length && <div className={styles.empty}><History size={30} /><b>Chưa có hoạt động</b><span>Lệnh mở, đóng và đăng bài sẽ xuất hiện tại đây.</span></div>}
      </section>
    </div>
  </div>;
}
