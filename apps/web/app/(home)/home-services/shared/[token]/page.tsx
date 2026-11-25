import { HomeShared } from "../../../../../components/home/HomeTracking";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <HomeShared token={token} />;
}
