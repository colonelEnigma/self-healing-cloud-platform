import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import PropTypes from "prop-types";

function RequireAuth({ children }) {
  const { token } = useAuth();

  if (!token) {
    return <Navigate to="/authentication/sign-in" replace />;
  }

  return children;
}

RequireAuth.propTypes = {
  children: PropTypes.node.isRequired,
};

export default RequireAuth;
