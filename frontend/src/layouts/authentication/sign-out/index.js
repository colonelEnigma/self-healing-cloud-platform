import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "auth/AuthProvider";

function SignOut() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    console.log("Logging out...");
    logout();
    navigate("/authentication/sign-in");
  }, []);

  return <div>Signing out...</div>;
}

export default SignOut;
