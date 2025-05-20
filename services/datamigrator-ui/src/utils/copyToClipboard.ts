export function copyToClipboard(text:string):void {
    if(navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            console.log("text copied")
        }).catch(err => console.error("failed to copy the text", err))
    }
}