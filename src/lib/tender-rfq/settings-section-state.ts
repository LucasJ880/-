/**
 * W-2 「询价与落地价设置」一节的页面状态（纯函数 reducer）
 *
 * 组件只负责取数、调接口、把结果 dispatch 进来；读、改、存、出错的每一步都在这里，可以逐条测。
 */

import {
  bodyFromForm,
  emptyFxRow,
  emptyProjectRow,
  formFromView,
  removeFxRow,
  removeProjectRow,
  updateFxRow,
  updateProjectRow,
  type EstimateForm,
  type FxRow,
  type ProjectRow,
  type TenderRfqSettingsBody,
  type TenderRfqSettingsForm,
  type TenderRfqSettingsView,
} from "./settings-form";

export type TenderProjectOption = { id: string; name: string };

export type SectionState = {
  /** loading：还在读；hidden：不是管理员（接口 403），这一节不显示；error：读失败；ready：可编辑 */
  phase: "loading" | "hidden" | "error" | "ready";
  loadError: string | null;
  form: TenderRfqSettingsForm | null;
  initial: TenderRfqSettingsForm | null;
  projects: TenderProjectOption[];
  projectsError: string | null;
  errors: string[];
  msg: string | null;
  busy: boolean;
};

type ScalarKey = "fromName" | "fromEmail" | "mailboxEmail" | "fxAsOf" | "fxSource" | "insurancePct" | "clearanceFlatCad";

export type SectionAction =
  | { type: "loaded"; view: TenderRfqSettingsView }
  | { type: "loadFailed"; status: number | null }
  | { type: "projectsLoaded"; projects: TenderProjectOption[] }
  | { type: "projectsFailed" }
  | { type: "set"; key: ScalarKey; value: string }
  | { type: "estimate"; key: "freight" | "inland"; patch: Partial<EstimateForm> }
  | { type: "fxAdd" }
  | { type: "fxUpdate"; index: number; patch: Partial<FxRow> }
  | { type: "fxRemove"; index: number }
  | { type: "projectAdd" }
  | { type: "projectUpdate"; index: number; patch: Partial<ProjectRow> }
  | { type: "projectRemove"; index: number }
  | { type: "reset" }
  | { type: "validationFailed"; errors: string[] }
  | { type: "nothingToSave" }
  | { type: "saveStarted" }
  | { type: "saveSucceeded"; view: TenderRfqSettingsView }
  | { type: "saveFailed"; error?: string | null; issues?: string[] | null };

export const LOAD_FAILED_ZH = "询价与落地价设置读取失败，请刷新页面重试。";
export const PROJECTS_FAILED_ZH = "招投标项目列表读取失败：已有的项目设置照常显示（名称可能显示为 id），暂时不能新加项目。";
export const SAVED_ZH = "已保存";
export const NOTHING_TO_SAVE_ZH = "没有改动";
export const SAVE_FAILED_ZH = "保存失败";

export const initialSectionState = (): SectionState => ({
  phase: "loading",
  loadError: null,
  form: null,
  initial: null,
  projects: [],
  projectsError: null,
  errors: [],
  msg: null,
  busy: false,
});

function edit(state: SectionState, f: (form: TenderRfqSettingsForm) => TenderRfqSettingsForm): SectionState {
  if (!state.form || state.busy) return state;
  return { ...state, form: f(state.form), msg: null };
}

export function sectionReducer(state: SectionState, a: SectionAction): SectionState {
  switch (a.type) {
    case "loaded": {
      const f = formFromView(a.view);
      return { ...state, phase: "ready", loadError: null, form: f, initial: f, errors: [], busy: false };
    }
    case "loadFailed":
      // 只有 403（不是管理员）才整节不显示；别的失败要让人知道
      return a.status === 403 ? { ...state, phase: "hidden" } : { ...state, phase: "error", loadError: LOAD_FAILED_ZH };
    case "projectsLoaded":
      return { ...state, projects: a.projects, projectsError: null };
    case "projectsFailed":
      return { ...state, projects: [], projectsError: PROJECTS_FAILED_ZH };
    case "set":
      return edit(state, (f) => ({ ...f, [a.key]: a.value }));
    case "estimate":
      return edit(state, (f) => ({ ...f, [a.key]: { ...f[a.key], ...a.patch } }));
    case "fxAdd":
      return edit(state, (f) => ({ ...f, fxRows: [...f.fxRows, emptyFxRow()] }));
    case "fxUpdate":
      return edit(state, (f) => updateFxRow(f, a.index, a.patch));
    case "fxRemove":
      return edit(state, (f) => removeFxRow(f, a.index));
    case "projectAdd":
      return state.projectsError ? state : edit(state, (f) => ({ ...f, projects: [...f.projects, emptyProjectRow()] }));
    case "projectUpdate":
      return edit(state, (f) => updateProjectRow(f, a.index, a.patch));
    case "projectRemove":
      return edit(state, (f) => removeProjectRow(f, a.index));
    case "reset":
      return state.busy ? state : { ...state, form: state.initial, errors: [], msg: null };
    case "validationFailed":
      return { ...state, errors: a.errors, msg: null };
    case "nothingToSave":
      return { ...state, errors: [], msg: NOTHING_TO_SAVE_ZH };
    case "saveStarted":
      return { ...state, busy: true, errors: [], msg: null };
    case "saveSucceeded": {
      // 用 PUT 返回的设置更新表单与「打开时的值」，不再另读一次（读失败也不会让这一节消失）
      const f = formFromView(a.view);
      return { ...state, busy: false, form: f, initial: f, errors: [], msg: SAVED_ZH };
    }
    case "saveFailed":
      return { ...state, busy: false, errors: [a.error || SAVE_FAILED_ZH, ...(a.issues ?? [])], msg: null };
  }
}

/** 点「保存」时：先在页面上校验；有错或没改动就不调接口 */
export function prepareSave(state: SectionState): { kind: "errors"; errors: string[] } | { kind: "empty" } | { kind: "send"; body: TenderRfqSettingsBody } | { kind: "noop" } {
  if (!state.form || !state.initial || state.busy) return { kind: "noop" };
  const r = bodyFromForm(state.form, state.initial);
  if (!r.ok) return { kind: "errors", errors: r.errors };
  if (r.empty) return { kind: "empty" };
  return { kind: "send", body: r.body };
}
