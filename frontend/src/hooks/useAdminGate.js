import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

// Redirects to /admin/login if there is no fully-verified (password + OTP)
// admin session in this tab. Call at the top of every /admin/* page.
export function useAdminGate() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!sessionStorage.getItem("proofpay-admin-jwt")) {
      navigate("/admin/login", { replace: true, state: { redirectTo: location.pathname } });
    }
  }, [navigate, location.pathname]);
}
