import HelpDrawerLayout from "@modules/Help/components/shared/HelpDrawerLayout";
import { UpgradeProvider } from "./context/UpgrdeContext";
import UpgradeContent from "./components/UpgradeContent";
import { HELP_ITEMS_ENUM } from "@modules/Help/constants/help.constants";


const upgrade = () => {
    return (
        <UpgradeProvider>
            <HelpDrawerLayout
                label={HELP_ITEMS_ENUM.UPGRADE}
                width="50rem"
                contentClassName=""
            >
                <UpgradeContent />
            </HelpDrawerLayout>
        </UpgradeProvider>
        
        <UpgradeProvider />
    )
}

export default upgrade;