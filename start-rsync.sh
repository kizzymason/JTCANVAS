sshpass -p 'asdW5228085' ssh -o StrictHostKeyChecking=no root@47.242.231.86 'mkdir -p /root/jt-migrate /opt/jtcanvas /etc/nginx/ssl/jingtiang.com'
nohup sshpass -p 'asdW5228085' rsync -ah --partial --info=progress2 -e 'ssh -o StrictHostKeyChecking=no' /root/jt-migrate/storage.tgz root@47.242.231.86:/root/jt-migrate/storage.tgz >/root/jt-migrate/rsync-storage.log 2>&1 &
nohup sshpass -p 'asdW5228085' rsync -ah --partial --info=progress2 -e 'ssh -o StrictHostKeyChecking=no' /root/jt-migrate/images.tar root@47.242.231.86:/root/jt-migrate/images.tar >/root/jt-migrate/rsync-images.log 2>&1 &
