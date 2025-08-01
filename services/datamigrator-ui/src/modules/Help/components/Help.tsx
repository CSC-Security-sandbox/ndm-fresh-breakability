import { HelpProvider } from "@modules/Help/context/HelpContext";
import HelpList from "@modules/Help/components/HelpList";

const Help = () => {
  return (
    <HelpProvider>
      <HelpList />
    </HelpProvider>
  );
};

export default Help;
