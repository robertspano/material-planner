import { getCompanyFromRequest } from "@/lib/tenant";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const company = await getCompanyFromRequest();

  const branding = company
    ? {
        name: company.name,
        logoUrl: company.logoUrl,
        loginBackgroundUrl: company.loginBackgroundUrl,
        primaryColor: company.primaryColor,
        secondaryColor: company.secondaryColor,
      }
    : null;

  return <LoginForm company={branding} />;
}
