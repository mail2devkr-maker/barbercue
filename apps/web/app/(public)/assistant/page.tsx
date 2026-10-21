import type { Metadata } from "next";
import { CustomerAssistant } from "../../../components/assistant/CustomerAssistant";

export const metadata: Metadata = {
  title: "Find a time",
  description: "Search real shops, prices and open times for a service on FastQue. Nothing is booked until you confirm.",
};

export default function AssistantPage() {
  return <CustomerAssistant />;
}
