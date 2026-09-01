"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [defaultLeadsText, setDefaultLeadsText] = useState("5, 1, 0");

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

  /** "잡음" 체크: 기본은 지금 시각, 필요하면 실제로 잡은 시각(HH:MM)을 입력받아 그 시각부터 다음 젠을 계산한다. */
  function markSpawned(boss: Boss) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const input = prompt(`처치 시각 (HH:MM, 그냥 확인 = 지금 ${nowHHMM})`, nowHHMM);
    if (input === null) return; // 취소

    const trimmed = input.trim();
    let killedAt = now;
    if (trimmed !== "" && trimmed !== nowHHMM) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
      if (!m) {
        alert("시간 형식이 올바르지 않습니다. 예: 14:30");
        return;
      }
      killedAt = new Date(now);
      killedAt.setHours(Number(m[1]), Number(m[2]), 0, 0);
      // 입력한 시각이 아직 안 왔다면(미래) 어제 그 시각에 잡은 것으로 간주
      if (killedAt.getTime() > now.getTime()) killedAt.setDate(killedAt.getDate() - 1);
    }

    upsertBoss({ ...boss, lastSpawnAt: killedAt.toISOString() });
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
            className="btn"
            disabled={pushState === "unsupported" || pushState === "checking" || pushBusy}
            onClick={togglePush}
          >
            {pushState === "subscribed" ? "🔔 알림 켜짐" : "🔕 알림 켜기"}
          </button>
          {pushState === "unsupported" && <span className="hint">이 브라우저는 미지원</span>}
        </div>
      </header>

      <div className="settings-row">
        <label htmlFor="defaultLeads">기본 알림 시점 (분 전, 쉼표로 여러 개, 0=등장 시)</label>
        <input
          id="defaultLeads"
          type="text"
          placeholder="5, 1, 0"
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
          {sorted.map(({ boss, next }) => {
            const notifyOn = boss.notifyEnabled !== false;
            const leads = effectiveLeads(boss, data.settings.defaultLeads);
            const urgency = notifyOn ? urgencyOf(leads, next, now) : "none";
            return (
              <div key={boss.id} className={`boss-card urgency-${urgency}`}>
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
                <div className="boss-actions">
                  <button
                    className="btn small"
                    onClick={() => toggleNotify(boss)}
                    aria-label={notifyOn ? "알림 끄기" : "알림 켜기"}
                    title={notifyOn ? "알림 끄기" : "알림 켜기"}
                  >
                    {notifyOn ? "🔔" : "🔕"}
                  </button>
                  {boss.type === "interval" && (
                    <button className="btn small" onClick={() => markSpawned(boss)}>
                      잡음 체크
                    </button>
                  )}
                  <button className="btn small" onClick={() => setEditing(boss)}>
                    수정
                  </button>
                  <button className="btn small danger" onClick={() => deleteBoss(boss.id)}>
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
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
              <label htmlFor="lastSpawnAt">마지막 젠(처치) 시각</label>
              <input
                id="lastSpawnAt"
                type="datetime-local"
                value={lastSpawnAt}
                onChange={(e) => setLastSpawnAt(e.target.value)}
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
          <button type="button" className="btn" onClick={onCancel}>
            취소
          </button>
          <button type="submit" className="btn primary">
            저장
          </button>
        </div>
      </form>
    </div>
  );
}
