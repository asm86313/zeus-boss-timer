"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Boss, BossData, BossType } from "@/lib/types";
import { DEFAULT_BOSS_DATA } from "@/lib/types";
import {
  DAY_LABELS,
  effectiveLeads,
  fmtAbs,
  fmtCountdown,
  fmtLeads,
  nextOccurrence,
  typeLabel,
  urgencyOf,
} from "@/lib/boss-logic";
import { getExistingSubscription, pushSupported, subscribePush, unsubscribePush } from "@/lib/push-client";

type PushState = "checking" | "unsupported" | "subscribed" | "unsubscribed";

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

/** Parses "5, 1, 0" -> [5, 1, 0]; drops invalid/negative entries, dedups, sorts descending. */
function parseLeadsText(text: string): number[] {
  const nums = text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "")
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);
  return [...new Set(nums)].sort((a, b) => b - a);
}

export default function Home() {
  const [data, setData] = useState<BossData | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [saving, setSaving] = useState(false);
  const [pushState, setPushState] = useState<PushState>("checking");
  const [pushBusy, setPushBusy] = useState(false);
  const [editing, setEditing] = useState<Boss | null | undefined>(undefined); // undefined = form closed
  const [catching, setCatching] = useState<Boss | null>(null); // null = 잡음체크 모달 닫힘
  const [defaultLeadsText, setDefaultLeadsText] = useState("10");

  useEffect(() => {
    fetch("/api/bosses")
      .then((r) => r.json())
      .then((d: BossData) => setData(d))
      .catch(() => setData(DEFAULT_BOSS_DATA));
  }, []);

  const defaultLeadsKey = data?.settings.defaultLeads.join(",") ?? "";
  useEffect(() => {
    if (data) setDefaultLeadsText(data.settings.defaultLeads.join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultLeadsKey]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 보스 추가/수정 모달이 열려있는 동안만 히스토리 1개를 쌓아서, 뒤로가기를
  // 누르면 앱이 꺼지는 대신 모달만 닫히게 한다. 모달이 버튼(저장/취소)으로
  // 닫힌 경우엔 쌓아뒀던 히스토리를 다시 back()으로 정리해 남기지 않는다.
  const modalOpen = editing !== undefined || catching !== null;
  useEffect(() => {
    if (!modalOpen) return;

    let closedByBackButton = false;
    history.pushState({ zeusModalGuard: true }, "");

    function handlePopState() {
      closedByBackButton = true;
      setEditing(undefined);
      setCatching(null);
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (!closedByBackButton) history.back(); // 우리가 쌓아둔 더미 정리
    };
  }, [modalOpen]);

  useEffect(() => {
    (async () => {
      if (!pushSupported()) {
        setPushState("unsupported");
        return;
      }
      const sub = await getExistingSubscription();
      setPushState(sub ? "subscribed" : "unsubscribed");
    })();
  }, []);

  async function persist(next: BossData) {
    setData(next);
    setSaving(true);
    try {
      await fetch("/api/bosses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } finally {
      setSaving(false);
    }
  }

  function upsertBoss(boss: Boss) {
    if (!data) return;
    const exists = data.bosses.some((b) => b.id === boss.id);
    const bosses = exists ? data.bosses.map((b) => (b.id === boss.id ? boss : b)) : [...data.bosses, boss];
    persist({ ...data, bosses });
    setEditing(undefined);
  }

  function deleteBoss(id: string) {
    if (!data) return;
    if (!confirm("이 보스를 삭제할까요?")) return;
    persist({ ...data, bosses: data.bosses.filter((b) => b.id !== id) });
  }

  function confirmCatch(killedAt: Date) {
    if (!catching) return;
    upsertBoss({ ...catching, lastSpawnAt: killedAt.toISOString() });
    setCatching(null);
  }

  function toggleNotify(boss: Boss) {
    upsertBoss({ ...boss, notifyEnabled: boss.notifyEnabled === false });
  }

  function updateDefaultLeads(text: string) {
    if (!data) return;
    const leads = parseLeadsText(text);
    if (!leads.length) return;
    persist({ ...data, settings: { ...data.settings, defaultLeads: leads } });
  }

  async function togglePush() {
    setPushBusy(true);
    try {
      if (pushState === "subscribed") {
        await unsubscribePush();
        setPushState("unsubscribed");
      } else {
        await subscribePush();
        setPushState("subscribed");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "알림 설정 중 오류가 발생했습니다.");
    } finally {
      setPushBusy(false);
    }
  }

  const sorted = useMemo(() => {
    if (!data) return [];
    return data.bosses
      .map((boss) => ({ boss, next: nextOccurrence(boss, now) }))
      .sort((a, b) => {
        if (!a.next && !b.next) return a.boss.name.localeCompare(b.boss.name);
        if (!a.next) return 1;
        if (!b.next) return -1;
        return a.next.getTime() - b.next.getTime();
      });
  }, [data, now]);

  return (
    <div className="page">
      <header className="app-header">
        <div>
          <h1>
            제우스: <span className="accent">오만의 신</span> 보스타임
          </h1>
          <div className="sub">젠타임 관리 및 알림</div>
        </div>
        <div className="push-btn">
          <button
            className="btn push-toggle-btn"
            disabled={pushState === "unsupported" || pushState === "checking" || pushBusy}
            onClick={togglePush}
          >
            <span className="notify-icon">{pushState === "subscribed" ? "🔔" : "🔕"}</span>
            <span className="notify-label">{pushState === "subscribed" ? "켜짐" : "꺼짐"}</span>
          </button>
          {pushState === "unsupported" && <span className="hint">이 브라우저는 미지원</span>}
        </div>
      </header>

      <div className="settings-row">
        <label htmlFor="defaultLeads">기본 알림 시점 (분 전, 쉼표로 여러 개, 0=등장 시)</label>
        <input
          id="defaultLeads"
          type="text"
          placeholder="10"
          value={defaultLeadsText}
          onChange={(e) => setDefaultLeadsText(e.target.value)}
          onBlur={(e) => updateDefaultLeads(e.target.value)}
        />
        {saving && <span className="saving">저장 중...</span>}
      </div>

      <div className="toolbar">
        <h2>보스 목록 ({sorted.length})</h2>
      </div>

      {!data ? (
        <div className="empty">불러오는 중...</div>
      ) : sorted.length === 0 ? (
        <div className="empty">등록된 보스가 없습니다. 오른쪽 아래 + 버튼으로 추가하세요.</div>
      ) : (
        <div className="boss-list">
          {sorted.map(({ boss, next }) => (
            <BossCard
              key={boss.id}
              boss={boss}
              next={next}
              now={now}
              defaultLeads={data.settings.defaultLeads}
              onToggleNotify={toggleNotify}
              onMarkSpawned={setCatching}
              onEdit={setEditing}
              onDelete={deleteBoss}
            />
          ))}
        </div>
      )}

      <button className="fab" onClick={() => setEditing(null)} aria-label="보스 추가" disabled={!data}>
        +
      </button>

      {editing !== undefined && data && (
        <BossForm
          initial={editing}
          defaultLeads={data.settings.defaultLeads}
          onCancel={() => setEditing(undefined)}
          onSubmit={upsertBoss}
        />
      )}

      {catching && (
        <CatchModal boss={catching} onCancel={() => setCatching(null)} onConfirm={confirmCatch} />
      )}
    </div>
  );
}

/** "잡음 체크" 시각 입력 모달. 기본은 지금 시각, 필요하면 실제로 잡은
 * 시각을 골라서 그 시각부터 다음 젠을 계산하게 한다. */
function CatchModal({
  boss,
  onCancel,
  onConfirm,
}: {
  boss: Boss;
  onCancel: () => void;
  onConfirm: (killedAt: Date) => void;
}) {
  const [agoMinutes, setAgoMinutes] = useState(0); // 0 = 지금

  const killedAt = useMemo(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - agoMinutes, 0, 0);
    return d;
  }, [agoMinutes]);

  function adjust(delta: number) {
    setAgoMinutes((m) => Math.max(0, m + delta));
  }

  function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    onConfirm(killedAt);
  }

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="modal-overlay">
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleConfirm}>
        <h2>{boss.name} 잡음 체크</h2>

        <div className="catch-display">
          <div className="catch-time">
            {pad(killedAt.getHours())}:{pad(killedAt.getMinutes())}
          </div>
          <div className="catch-ago">{agoMinutes === 0 ? "지금" : `${agoMinutes}분 전`}</div>
        </div>

        <div className="catch-adjust">
          <button type="button" className="btn" onClick={() => adjust(10)}>
            -10분
          </button>
          <button type="button" className="btn" onClick={() => adjust(5)}>
            -5분
          </button>
          <button type="button" className="btn" onClick={() => adjust(1)}>
            -1분
          </button>
          <button type="button" className="btn" onClick={() => setAgoMinutes(0)}>
            지금
          </button>
          <button type="button" className="btn" onClick={() => adjust(-1)} disabled={agoMinutes < 1}>
            +1분
          </button>
          <button type="button" className="btn" onClick={() => adjust(-5)} disabled={agoMinutes < 5}>
            +5분
          </button>
          <button type="button" className="btn" onClick={() => adjust(-10)} disabled={agoMinutes < 10}>
            +10분
          </button>
        </div>

        <div className="modal-actions">
          <button type="submit" className="btn primary">
            확인
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            취소
          </button>
        </div>
      </form>
    </div>
  );
}

const SWIPE_REVEAL = 228; // 알림(76) + 수정(76) + 삭제(76)

/** 왼쪽으로 스와이프하면 오른쪽에 삭제 칸이 나오는 보스 카드. (오른쪽 끝에 항상
 * 있는 액션 버튼들이 스와이프 중에도 안 가려지도록, 가려지는 건 보스 이름 쪽.) */
function BossCard({
  boss,
  next,
  now,
  defaultLeads,
  onToggleNotify,
  onMarkSpawned,
  onEdit,
  onDelete,
}: {
  boss: Boss;
  next: Date | null;
  now: Date;
  defaultLeads: number[];
  onToggleNotify: (boss: Boss) => void;
  onMarkSpawned: (boss: Boss) => void;
  onEdit: (boss: Boss) => void;
  onDelete: (id: string) => void;
}) {
  const [x, setX] = useState(0); // 0(닫힘) ~ -SWIPE_REVEAL(열림)
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; y: number; baseX: number } | null>(null);
  const axisRef = useRef<"h" | "v" | null>(null);
  const draggedRef = useRef(false); // 실제로 움직였는지 — 살짝 끌었다 놓은 걸 탭으로 오인하지 않기 위함

  function onPointerDown(e: React.PointerEvent) {
    startRef.current = { x: e.clientX, y: e.clientY, baseX: x };
    axisRef.current = null;
    draggedRef.current = false;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!startRef.current) return;
    // 버튼이 안 눌린 상태(호버)로 들어오는 마우스 move는 전부 무시.
    if (e.pointerType === "mouse" && e.buttons === 0) {
      startRef.current = null;
      return;
    }
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    // 마우스는 버튼을 누른 채로 완전히 정지해 있기 어렵고(손떨림 수준의
    // 미세한 움직임) 터치보다 훨씬 잘 흔들리므로 임계값을 더 넉넉히 잡는다.
    const threshold = e.pointerType === "mouse" ? 24 : 8;
    if (axisRef.current === null) {
      if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
        axisRef.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
        draggedRef.current = true;
      }
    }
    if (axisRef.current === "h") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setX(Math.min(0, Math.max(startRef.current.baseX + dx, -SWIPE_REVEAL)));
    }
  }

  // 브라우저 네이티브 click 이벤트는 preventDefault/포인터 캡처 등과
  // 얽혀서 미묘하게 씹히는 경우가 있었어서, 탭/스와이프 판정을 전부
  // 포인터 이벤트만으로 직접 처리한다 (click에 의존하지 않음).
  function onPointerUp() {
    if (!startRef.current) return; // 버튼 자체를 누른 press(전파 차단됨) — 여기서 할 일 없음

    const wasHorizontalDrag = axisRef.current === "h";
    const wasAnyDrag = draggedRef.current;

    startRef.current = null;
    axisRef.current = null;
    setDragging(false);

    if (wasHorizontalDrag) {
      setX((cur) => (cur < -SWIPE_REVEAL / 2 ? -SWIPE_REVEAL : 0));
      return;
    }
    if (wasAnyDrag) return;
    if (x !== 0) {
      setX(0); // 열려있는 상태에서 탭하면 닫기만 함
      return;
    }
    if (boss.type === "interval") onMarkSpawned(boss);
  }

  function onPointerCancel() {
    if (axisRef.current === "h") {
      setX((cur) => (cur < -SWIPE_REVEAL / 2 ? -SWIPE_REVEAL : 0));
    }
    startRef.current = null;
    axisRef.current = null;
    draggedRef.current = false;
    setDragging(false);
  }

  const notifyOn = boss.notifyEnabled !== false;
  const leads = effectiveLeads(boss, defaultLeads);
  const urgency = notifyOn ? urgencyOf(leads, next, now) : "none";

  return (
    <div className="boss-swipe">
      <div
        className={`boss-swipe-track${dragging ? " dragging" : ""}`}
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div className={`boss-card urgency-${urgency}`}>
          <div className="boss-main">
            <div className="boss-name-row">
              <span className="boss-name">{boss.name}</span>
              <span className="boss-type">{typeLabel(boss)}</span>
            </div>
            {boss.memo && <div className="boss-memo">{boss.memo}</div>}
            <div className="boss-meta">
              {fmtAbs(next)} · {notifyOn ? `${fmtLeads(leads)} 알림` : "알림 꺼짐"}
            </div>
          </div>
          <div className="boss-countdown">{next ? fmtCountdown(next.getTime() - now.getTime()) : "-"}</div>
        </div>
        <div
          className="swipe-action-btn notify"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            setX(0);
            onToggleNotify(boss);
          }}
        >
          <span className="notify-icon">{notifyOn ? "🔔" : "🔕"}</span>
          <span className="notify-label">{notifyOn ? "켜짐" : "꺼짐"}</span>
        </div>
        <div
          className="swipe-action-btn edit"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            setX(0);
            onEdit(boss);
          }}
        >
          수정
        </div>
        <div
          className="swipe-action-btn delete"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onDelete(boss.id)}
        >
          삭제
        </div>
      </div>
    </div>
  );
}

function BossForm({
  initial,
  defaultLeads,
  onCancel,
  onSubmit,
}: {
  initial: Boss | null;
  defaultLeads: number[];
  onCancel: () => void;
  onSubmit: (boss: Boss) => void;
}) {
  const isNew = initial === null;
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<BossType>(initial?.type ?? "fixed");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [notifyEnabled, setNotifyEnabled] = useState(initial?.notifyEnabled !== false);
  const [leadMinutesText, setLeadMinutesText] = useState(
    initial?.leadMinutes && initial.leadMinutes.length ? initial.leadMinutes.join(", ") : ""
  );
  const [timesText, setTimesText] = useState((initial?.times ?? []).join(", "));
  const [days, setDays] = useState<number[]>(initial?.days ?? []);
  const [intervalMinutes, setIntervalMinutes] = useState(
    initial?.intervalMinutes ? String(initial.intervalMinutes) : "180"
  );
  const [lastSpawnAt, setLastSpawnAt] = useState(
    toLocalInputValue(initial?.lastSpawnAt ? new Date(initial.lastSpawnAt) : new Date())
  );
  const [minutesUntil, setMinutesUntil] = useState("");

  /** "지금부터 82분 후 출현" -> 처치 시각을 거꾸로 계산해서 자동으로 채워준다. */
  function handleMinutesUntilChange(text: string) {
    setMinutesUntil(text);
    const mins = Number(text);
    const interval = Number(intervalMinutes);
    if (text.trim() === "" || !Number.isFinite(mins) || mins < 0 || !Number.isFinite(interval) || interval <= 0) {
      return;
    }
    const killedAt = new Date(Date.now() + mins * 60000 - interval * 60000);
    setLastSpawnAt(toLocalInputValue(killedAt));
  }

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      alert("보스 이름을 입력하세요.");
      return;
    }

    const parsedLeads = parseLeadsText(leadMinutesText);

    const base: Boss = {
      id: initial?.id ?? genId(),
      name: name.trim(),
      type,
      memo: memo.trim() || undefined,
      leadMinutes: parsedLeads.length ? parsedLeads : null,
      notifyEnabled,
    };

    if (type === "fixed") {
      const times = timesText
        .split(",")
        .map((t) => t.trim())
        .filter((t) => /^\d{1,2}:\d{2}$/.test(t))
        .map((t) => {
          const [h, m] = t.split(":");
          return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
        });
      if (!times.length) {
        alert("젠 시각을 하나 이상 입력하세요. 예: 12:00, 18:00");
        return;
      }
      onSubmit({ ...base, times, days: days.length ? days : undefined });
    } else {
      const mins = Number(intervalMinutes);
      if (!mins || mins <= 0) {
        alert("주기(분)를 올바르게 입력하세요.");
        return;
      }
      onSubmit({
        ...base,
        intervalMinutes: mins,
        lastSpawnAt: new Date(lastSpawnAt).toISOString(),
      });
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{isNew ? "보스 추가" : "보스 수정"}</h2>

        <div className="field">
          <label htmlFor="name">이름</label>
          <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>

        <div className="field">
          <label htmlFor="type">타입</label>
          <select id="type" value={type} onChange={(e) => setType(e.target.value as BossType)}>
            <option value="fixed">고정 시각 (매일/요일 지정)</option>
            <option value="interval">주기 (처치 후 N분마다)</option>
          </select>
        </div>

        {type === "fixed" ? (
          <>
            <div className="field">
              <label htmlFor="times">젠 시각 (HH:MM, 쉼표로 여러 개)</label>
              <input
                id="times"
                type="text"
                placeholder="예: 12:00, 18:00, 21:30"
                value={timesText}
                onChange={(e) => setTimesText(e.target.value)}
              />
            </div>
            <div className="field">
              <label>요일 (선택 없으면 매일)</label>
              <div className="day-checks">
                {DAY_LABELS.map((label, d) => (
                  <div
                    key={d}
                    className={`day-check ${days.includes(d) ? "checked" : ""}`}
                    onClick={() => toggleDay(d)}
                  >
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="interval">주기 (분)</label>
              <input
                id="interval"
                type="number"
                min={1}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(e.target.value)}
              />
              <div className="hint">
                {intervalMinutes && Number(intervalMinutes) > 0
                  ? `${Math.round((Number(intervalMinutes) / 60) * 10) / 10}시간`
                  : ""}
              </div>
            </div>
            <div className="field">
              <label htmlFor="minutesUntil">지금부터 몇 분 후 출현? (입력하면 아래 처치 시각 자동 계산)</label>
              <input
                id="minutesUntil"
                type="number"
                min={0}
                placeholder="예: 82"
                value={minutesUntil}
                onChange={(e) => handleMinutesUntilChange(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="lastSpawnAt">마지막 젠(처치) 시각</label>
              <input
                id="lastSpawnAt"
                type="datetime-local"
                value={lastSpawnAt}
                onChange={(e) => {
                  setLastSpawnAt(e.target.value);
                  setMinutesUntil(""); // 수동으로 고치면 자동계산 입력은 무효화
                }}
              />
            </div>
          </>
        )}

        <div className="field">
          <label className="check-label">
            <input
              type="checkbox"
              checked={notifyEnabled}
              onChange={(e) => setNotifyEnabled(e.target.checked)}
            />
            이 보스 알림 사용
          </label>
        </div>

        <div className="field">
          <label htmlFor="lead">알림 시점 (분 전, 쉼표로 여러 개, 0=등장 시, 비우면 기본값 사용)</label>
          <input
            id="lead"
            type="text"
            placeholder={`기본값 (${defaultLeads.join(", ")})`}
            value={leadMinutesText}
            onChange={(e) => setLeadMinutesText(e.target.value)}
            disabled={!notifyEnabled}
          />
        </div>

        <div className="field">
          <label htmlFor="memo">메모</label>
          <textarea id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>

        <div className="modal-actions">
          <button type="submit" className="btn primary">
            저장
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            취소
          </button>
        </div>
      </form>
    </div>
  );
}
