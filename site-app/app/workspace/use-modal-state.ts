import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Finding } from "@/lib/domain/types";

export function getForm(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries()) as Record<
    string,
    string
  >;
}
/** Serialises a form's fields, choices and checks to detect unsaved entries. */
export function formFingerprint(
  form: HTMLFormElement | null,
  choices: Record<string, string>,
  checks: Record<string, boolean>,
) {
  const fields = form
    ? [...new FormData(form).entries()].map(([key, value]) => [
        key,
        typeof value === "string"
          ? value
          : value.name
            ? {
                name: value.name,
                size: value.size,
                type: value.type,
                lastModified: value.lastModified,
              }
            : null,
      ])
    : [];
  return JSON.stringify({
    fields,
    choices: Object.entries(choices)
      .filter(([, v]) => v)
      .sort(([a], [b]) => a.localeCompare(b)),
    checks: Object.keys(checks)
      .filter((key) => checks[key])
      .sort(),
  });
}

/**
 * The open form dialog: which form is open, its select and checkbox values
 * (the other fields are uncontrolled inputs), unsaved-entry tracking against
 * the values it opened with, the discard confirmation and the error shown.
 */
export function useModalState() {
  const [modal, showModal] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({}),
    [checks, setChecks] = useState<Record<string, boolean>>({});
  const [finding, setFinding] = useState<Finding | null>(null);
  const [modalDirty, setModalDirty] = useState(false),
    [discardModal, setDiscardModal] = useState(false),
    [modalError, setModalError] = useState("");
  const modalFormRef = useRef<HTMLFormElement>(null),
    modalErrorRef = useRef<HTMLParagraphElement>(null),
    modalBaselineRef = useRef(""),
    modalSubmitting = useRef(false),
    modalDirtyRef = useRef(false);
  useLayoutEffect(() => {
    modalDirtyRef.current = modalDirty;
  });
  /** Opens another form or closes it ("") with a fresh dirty, error and discard state. */
  function setModal(name: string) {
    if (!name) modalBaselineRef.current = "";
    setModalDirty(false);
    setModalError("");
    setDiscardModal(false);
    showModal(name);
  }
  useEffect(() => {
    if (modal && modalBaselineRef.current)
      setModalDirty(
        formFingerprint(modalFormRef.current, choices, checks) !==
          modalBaselineRef.current,
      );
  }, [choices, checks, modal]);
  function open(
    name: string,
    defaults: Record<string, string> = {},
    flags: Record<string, boolean> = {},
  ) {
    modalBaselineRef.current = "";
    setModalError("");
    setModalDirty(false);
    setChoices(defaults);
    setChecks(flags);
    setModal(name);
  }
  const choice = (key: string, value: string) =>
    setChoices((x) => ({ ...x, [key]: value }));
  const check = (key: string, value: boolean) =>
    setChecks((c) => ({ ...c, [key]: value }));
  /** Ref callback of the form; the first fingerprint is the clean baseline. */
  function attachForm(form: HTMLFormElement | null) {
    modalFormRef.current = form;
    if (form && !modalBaselineRef.current)
      modalBaselineRef.current = formFingerprint(form, choices, checks);
  }
  function fieldsChanged() {
    setModalDirty(
      formFingerprint(modalFormRef.current, choices, checks) !==
        modalBaselineRef.current,
    );
  }
  /** Closes the form, or asks first when it has unsaved entries. */
  function close(busy: boolean) {
    if (busy) return;
    if (modalDirtyRef.current) setDiscardModal(true);
    else setModal("");
  }
  function discard() {
    setModalDirty(false);
    modalDirtyRef.current = false;
    setDiscardModal(false);
    setModal("");
  }
  /** True while a form is saving; guarded navigation from a save proceeds. */
  const isSubmitting = () => modalSubmitting.current;
  function setSubmitting(submitting: boolean) {
    modalSubmitting.current = submitting;
  }
  /** Ref callback of the error message, which receives focus when shown. */
  function attachError(element: HTMLParagraphElement | null) {
    modalErrorRef.current = element;
  }
  function showError(message: string) {
    setModalError(message);
    requestAnimationFrame(() => modalErrorRef.current?.focus());
  }
  return {
    modal,
    setModal,
    choices,
    checks,
    finding,
    setFinding,
    modalDirty,
    discardModal,
    setDiscardModal,
    modalError,
    setModalError,
    attachError,
    open,
    choice,
    check,
    attachForm,
    fieldsChanged,
    close,
    discard,
    isSubmitting,
    setSubmitting,
    showError,
  };
}
export type ModalState = ReturnType<typeof useModalState>;
