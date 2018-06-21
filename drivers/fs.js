const fs = require('fs');

function generateBackupCmd(type, image, datastore, hostname, program, config, vm, disk, excludedDisks)
{
    var srcPath, dstPath, mkDirPath;
    var cmd = [];

    var sourcePath = image.SOURCE.split('/');
    var sourceName = sourcePath.pop();
    var sshCipher = '';

    if(program.insecure) sshCipher = ' -c arcfour128';

    if(type === 'nonPersistentOrNotUsed' && datastore.TEMPLATE.TM_MAD === 'ssh'){
        hostname = config.frontend;
    }

    switch(type){
        case 'nonPersistentOrNotUsed':
        case 'standard':
            // set src and dest paths
            srcPath = image.SOURCE + '.snap';
            dstPath = config.backupDir + image.DATASTORE_ID + '/' + sourceName;

            // make dest dir
            mkDirPath = 'mkdir -p ' + dstPath + '.snap';
            if(!fs.existsSync(mkDirPath)) cmd.push(mkDirPath);

            // backup image
            if(program.netcat) {
                cmd.push('nc -l -p 5000 | dd of=' + dstPath + '.tmp & ssh oneadmin@' + hostname + ' \'dd if=' + image.SOURCE + ' | nc -w 3 ' + config.backupServerIp + ' 5000\'');
            } else {
                cmd.push('rsync -aHAXxWv --inplace --numeric-ids --progress -e "ssh -T' + sshCipher + ' -o Compression=no -x" oneadmin@' + hostname + ':' + image.SOURCE + ' ' + dstPath + '.tmp');
            }

            // check image if driver is qcow2
            if(image.TEMPLATE.DRIVER === 'qcow2' && program.check) {
                cmd.push('qemu-img check ' + dstPath);
            }

            // replace old image by new one
            cmd.push('mv -f ' + dstPath + '.tmp ' + dstPath);

            // create source snap dir if not exists
            cmd.push('ssh oneadmin@' + hostname + ' \'[ -d ' + srcPath + ' ] || mkdir ' + srcPath + '\'');

            // backup snap dir
            cmd.push('rsync -aHAXxWv --numeric-ids --progress -e "ssh -T' + sshCipher + ' -o Compression=no -x" oneadmin@' + hostname + ':' + srcPath + '/ ' + dstPath + '.snap/');
            break;

        case 'snapshotLive':
            var tmpDiskSnapshot = config.backupTmpDir + 'one-' + vm.ID + '-weekly-backup';

            // excluded disks
            var excludedDiskSpec = '';
            for(var key in excludedDisks) if (excludedDisks.hasOwnProperty(key)) {
                var excludedDisk = excludedDisks[key];

                excludedDiskSpec += ' --diskspec ' + excludedDisk + ',snapshot=no';
            }

            // create tmp snapshot file
            cmd.push('ssh oneadmin@' + hostname + ' \'touch ' + tmpDiskSnapshot + '\'');
            var liveSnapshotCmd = 'ssh oneadmin@' + hostname + ' \'virsh -c ' + config.libvirtUri + ' snapshot-create-as --domain one-' + vm.ID + ' weekly-backup' + excludedDiskSpec + ' --diskspec ' + disk.TARGET + ',file=' + tmpDiskSnapshot + ' --disk-only --atomic --no-metadata';

            // try to freeze fs if guest agent enabled
            if(vm.TEMPLATE.FEATURES !== undefined && vm.TEMPLATE.FEATURES.GUEST_AGENT !== undefined && vm.TEMPLATE.FEATURES.GUEST_AGENT === 'yes') {
                cmd.push(liveSnapshotCmd + ' --quiesce\' || ' + liveSnapshotCmd + '\'');

            } else {
                cmd.push(liveSnapshotCmd + '\'');
            }

            // set src and dest paths
            srcPath = image.SOURCE + '.snap';
            dstPath = config.backupDir + image.DATASTORE_ID + '/' + sourceName;

            // make dest dir
            mkDirPath = 'mkdir -p ' + dstPath + '.snap';
            if(!fs.existsSync(mkDirPath)) cmd.push(mkDirPath);

            // backup image
            if(program.netcat) {
                cmd.push('nc -l -p 5000 | dd of=' + dstPath + '.tmp & ssh oneadmin@' + hostname + ' \'dd if=' + image.SOURCE + ' | nc -w 3 ' + config.backupServerIp + ' 5000\'');
            } else {
                cmd.push('rsync -aHAXxWv --inplace --numeric-ids --progress -e "ssh -T' + sshCipher + ' -o Compression=no -x" oneadmin@' + hostname + ':' + image.SOURCE + ' ' + dstPath + '.tmp');
            }

            // check image if driver is qcow2
            if(image.TEMPLATE.DRIVER === 'qcow2' && program.check) {
                cmd.push('qemu-img check ' + dstPath + '.tmp');
            }

            // replace old image by new one
            cmd.push('mv -f ' + dstPath + '.tmp ' + dstPath);

            // create source snap dir if not exists
            cmd.push('ssh oneadmin@' + hostname + ' \'[ -d ' + srcPath + ' ] || mkdir ' + srcPath + '\'');
            // backup snap dir
            cmd.push('rsync -aHAXxWv --numeric-ids --progress -e "ssh -T' + sshCipher + ' -o Compression=no -x" oneadmin@' + hostname + ':' + srcPath + '/ ' + dstPath + '.snap/');

            // blockcommit tmp snapshot to original one
            cmd.push('ssh oneadmin@' + hostname + ' \'virsh -c ' + config.libvirtUri + ' blockcommit one-' + vm.ID + ' ' + disk.TARGET + ' --active --pivot --shallow --verbose\'');

            // clear tmp snapshot
            cmd.push('ssh oneadmin@' + hostname + ' \'rm -f ' + tmpDiskSnapshot + '\'');
            break;
    }

    return cmd;
}

exports.generateBackupCmd = generateBackupCmd;
