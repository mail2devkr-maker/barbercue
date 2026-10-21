"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../../lib/api";
import { canUseHrRegister } from "../../lib/admin-route-access";
import { useAuth } from "../../lib/auth-context";
import { httpHrRegisterApi, type HrRegisterApi } from "../../lib/hr-register/api";
import { describeHrFailure, isRegisterUnavailable } from "../../lib/hr-register/errors";
import { Banner } from "./parts";

type GateState = "checking" | "ready" | "unavailable" | "forbidden" | "error";

/**
 * Fails closed in three ways: the wrong role never reaches the register, an undeployed backend never
 * falls back to manual employee IDs, and any other failure blocks offer creation with the reason.
 * Client-side role checks are an affordance only; the backend RolesGuard is the authority.
 */
export default function RegisterGate({ api = httpHrRegisterApi, children }: { api?: HrRegisterApi; children: ReactNode }) {
  const { user, status } = useAuth();
  const allowed = canUseHrRegister(user?.roles ?? []);
  const [state, setState] = useState<GateState>("checking");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !allowed) return;
    let live = true;
    api
      .probe()
      .then(() => live && setState("ready"))
      .catch((failure: unknown) => {
        if (!live) return;
        if (failure instanceof ApiError && failure.status === 403) setState("forbidden");
        else if (isRegisterUnavailable(failure)) setState("unavailable");
        else {
          setState("error");
          setMessage(describeHrFailure(failure, "Could not reach the HR offer register."));
        }
      });
    return () => {
      live = false;
    };
  }, [api, allowed, status]);

  if (status === "loading") return <p role="status">Checking your access…</p>;
  if (!allowed) {
    return <Banner kind="warn">The HR offer register is limited to HR, Co-Founder and Platform Admin accounts.</Banner>;
  }
  if (state === "checking") return <p role="status">Opening the offer register…</p>;
  if (state === "forbidden") return <Banner kind="warn">Your account is not permitted to use the HR offer register.</Banner>;
  if (state === "unavailable") {
    return (
      <Banner kind="warn">
        The HR offer register is not available on this server yet, so offer letters cannot be generated. Employee IDs are issued only by the register — there is no manual fallback. Nothing was saved.
      </Banner>
    );
  }
  if (state === "error") return <Banner kind="error">{message}</Banner>;
  return <>{children}</>;
}
