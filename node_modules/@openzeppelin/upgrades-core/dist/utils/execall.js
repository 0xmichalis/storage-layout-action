"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.execall = void 0;
function* execall(re, text) {
    re = new RegExp(re, re.flags + (re.sticky ? '' : 'y'));
    while (true) {
        const match = re.exec(text);
        if (match && match[0] !== '') {
            yield match;
        }
        else {
            break;
        }
    }
}
exports.execall = execall;
//# sourceMappingURL=execall.js.map