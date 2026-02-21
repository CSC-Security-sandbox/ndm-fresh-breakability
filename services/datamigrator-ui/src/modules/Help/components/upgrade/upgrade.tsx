import HelpDrawerLayout from "@modules/Help/components/shared/HelpDrawerLayout";
import { UpgradeProvider } from "./context/UpgradeContext";
import UpgradeContent from "./components/UpgradeContent";
import { HELP_ITEMS_ENUM } from "@modules/Help/constants/help.constants";


const Upgrade = () => {
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
        
    )
}

export default Upgrade;