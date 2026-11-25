import { HomeTracking } from "../../../../../components/home/HomeTracking";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <HomeTracking code={code} />;
}
