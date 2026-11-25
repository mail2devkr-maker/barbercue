import { HomeProfile } from "../../../../../../components/home/HomeSearch";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HomeProfile id={id} />;
}
